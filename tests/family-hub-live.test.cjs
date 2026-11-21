const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');

const source = readFileSync(join(__dirname, '../custom_components/family_hub/card/family-hub-live.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(t, config, overrides = {}) {
  const dom = new JSDOM('', {runScripts:'outside-only', url:'http://localhost/'});
  t.after(() => dom.window.close());
  const {window} = dom;
  window.Date.now = () => Date.parse('2026-11-21T02:00:00Z');
  window.eval(source);
  const card = window.document.createElement('family-hub-live');
  const root = card.attachShadow({mode:'open'});
  const callbacks = [];
  let stops = 0;
  const calls = [];
  const event = (summary, start, end) => ({summary, start, end, description:'Sample notes'});
  const events = {
    'calendar.family': [event('Evening walk', {dateTime:'2026-11-21T02:00:00Z'}, {dateTime:'2026-11-21T03:00:00Z'})],
    'calendar.school': [event('Library day', {date:'2026-11-20'}, {date:'2026-11-21'})]
  };
  const hass = {
    config:{time_zone:'America/Chicago', unit_system:{temperature:'°F'}},
    states:{
      'calendar.family':{attributes:{friendly_name:'Family'}},
      'calendar.school':{attributes:{friendly_name:'School'}},
      'weather.home':{attributes:{temperature:62}},
      'light.office':{state:'on',attributes:{friendly_name:'Office'}}
    },
    connection:{async subscribeMessage(callback, request) {
      assert.equal(request.forecast_type, 'daily');
      callbacks.push(callback);
      return () => { stops++; };
    }},
    async callApi(method, path) {
      calls.push(path);
      return events[decodeURIComponent(path.split('/')[1].split('?')[0])] ?? [];
    },
    ...overrides
  };
  card.setConfig({type:'custom:family-hub-live', ...config});
  card.hass = hass;
  window.document.body.append(card);
  const find = selector => root.querySelector(selector);
  return {window, card, root, find, hass, callbacks, calls, stops:() => stops};
}

test('one HA-zone forecast feeds Week, Month and the selected day without losing today or event notes', async t => {
  const {card, find, callbacks, calls, stops, hass} = setup(t, {
    calendars:['calendar.family','calendar.school'], default_view:'month', weather_entity:'weather.home'
  });
  await tick();
  assert.equal(callbacks.length, 1);
  assert.match(decodeURIComponent(calls[0]), /start=2026-11-01T05:00:00.000Z&end=2026-12-01T06:00:00.000Z/);
  assert.equal(find('.month-day[aria-current]').dataset.day, '20');
  assert.equal(find('#month-grid ha-icon'), null);
  find('[data-day="20"]').click();
  assert.match(find('#day-events').textContent, /Evening walk/);
  assert.match(find('#day-events').textContent, /8:00/);
  find('#day-events details').open = true;
  callbacks[0]({forecast:[
    {datetime:'2026-11-21T02:00:00Z', condition:'partlycloudy', temperature:72, templow:50},
    {datetime:'2026-11-22', condition:'rainy', temperature:61}
  ]});
  assert.equal(find('[data-day="20"] ha-icon').getAttribute('icon'), 'mdi:weather-partly-cloudy');
  assert.equal(find('[data-day="21"] ha-icon'), null);
  assert.equal(find('[data-day="22"] ha-icon').getAttribute('icon'), 'mdi:weather-rainy');
  assert.equal(find('#day-events details').open, true);
  assert.match(find('#day-weather').textContent, /72°F/);
  assert.ok(find('#day-weather .wide-range .current'));
  card.hass = {...hass, states:{...hass.states, 'weather.home':{attributes:{temperature:72}}}};
  assert.equal(find('#day-weather .current').style.getPropertyValue('--position'), '0%');
  find('[data-day="22"]').click();
  assert.equal(find('.month-day[aria-current]').dataset.day, '20');
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '22');
  assert.match(find('#day-weather').textContent, /61°F/);
  assert.equal(find('#day-weather .range'), null);
  find('#week-view').click();
  assert.ok(find('#week-days .wide-range'));
  assert.equal(callbacks.length, 1);
  find('#month-view').click();
  callbacks[0]({forecast:[]});
  assert.equal(find('#month-grid ha-icon'), null);
  assert.equal(find('#day-weather').textContent, '');
  card.remove();
  await tick();
  assert.equal(stops(), 1);
});

test('legend isolates one calendar across both views and both event detail displays without fetching', async t => {
  const {window, root, find, calls} = setup(t, {
    calendars:['calendar.family','calendar.school'], calendar_colors:{'calendar.family':'#123456'}
  });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  await tick();
  const callsBefore = calls.length;
  const [family, school] = root.querySelectorAll('#calendar-legend button');
  family.click();
  assert.equal(family.getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(find('#week-days').textContent, /Library day/);
  find('[data-week-day="4"]').click();
  assert.match(find('#week-day-events').textContent, /Evening walk/);
  assert.doesNotMatch(find('#week-day-events').textContent, /Library day/);
  assert.equal(find('#week-day-events .event').style.getPropertyValue('--event-color'), '#123456');
  find('#month-view').click();
  find('[data-day="20"]').click();
  assert.doesNotMatch(find('#day-events').textContent, /Library day/);
  school.click();
  assert.equal(family.getAttribute('aria-pressed'), 'false');
  assert.equal(school.getAttribute('aria-pressed'), 'true');
  assert.match(find('#day-events').textContent, /Library day/);
  assert.doesNotMatch(find('#day-events').textContent, /Evening walk/);
  school.click();
  assert.match(find('#day-events').textContent, /Library day/);
  assert.match(find('#day-events').textContent, /Evening walk/);
  assert.equal(calls.length, callsBefore);
});

test('config skips malformed entries, deduplicates before applying limits and preserves ribbon and layout', async t => {
  const {window, card, root, find} = setup(t, {
    calendars:['calendar.family', null, 'calendar.family', 'light.office'],
    actions:['light.office','light.office','calendar.school','switch.one','script.two','button.three','cover.four'],
    widgets:['sensor.outside',{entity:'sensor.outside',type:'sensor'},'weather.home','climate.house','binary_sensor.door',
      {type:'entities',entities:['sensor.outside']},{type:'custom:example'},{type:'grid',cards:[]},
      {type:'entities',entities:[{type:'custom:example'}]}, {type:'tile',entity:'sensor.x',card:{type:'tile'}}],
    default_view:'invalid', ribbon_default:'collapsed', widget_layout:'wide', weather_entity:'sensor.outside'
  });
  const created = [];
  window.loadCardHelpers = async () => ({createCardElement(config) {
    created.push(config);
    return window.document.createElement('div');
  }});
  await tick();
  assert.deepEqual([...card.config.calendars], ['calendar.family']);
  assert.equal(root.querySelectorAll('.quick-control').length, 4);
  assert.ok(find('#quick-controls').hidden);
  assert.ok(find('.widget-grid.wide[data-count="4"]'));
  assert.deepEqual(created.map(config => config.type), ['sensor','weather-forecast','thermostat','tile']);
  assert.match(find('#config-status').textContent, /only the first 4 unique valid entries/);
  assert.match(find('#config-status').textContent, /weather_entity must/);
  assert.equal(find('#week').hidden, false);
  card.setConfig({widgets:'sensor.wrong', calendars:{}, actions:42});
  assert.ok(find('#widget-panel').hidden);
  assert.match(find('#config-status').textContent, /widgets must be a list/);
});

test('native cards receive current hass, survive reconfiguration and isolate helper or card errors', async t => {
  const widgets = [{type:'gauge', entity:'sensor.level', max:100}, {type:'entities',entities:['binary_sensor.door']},
    {type:'tile',entity:'sensor.broken'}, {type:'weather-forecast',entity:'weather.error'}];
  const {window, card, root, find, hass} = setup(t, {widgets});
  let helperLoads = 0;
  let creations = 0;
  const updates = [];
  window.loadCardHelpers = async () => {
    helperLoads++;
    return {createCardElement(config) {
      creations++;
      if (config.entity === 'sensor.broken') throw new Error('Card unavailable');
      if (config.entity === 'weather.error') return window.document.createElement('hui-error-card');
      const child = window.document.createElement('div');
      child.dataset.type = config.type;
      Object.defineProperty(child, 'hass', {set(value) { updates.push([config.type, value]); }});
      return child;
    }};
  };
  await tick();
  assert.equal(helperLoads, 1);
  assert.equal(creations, 4);
  const gauge = find('[data-type="gauge"]');
  assert.ok(gauge);
  assert.equal(root.querySelectorAll('.widget-status').length, 2);
  assert.match(find('.widget-status').textContent, /sensor.broken/);
  const latest = {...hass};
  card.hass = latest;
  assert.equal(updates.filter(([type,value]) => type === 'gauge' && value === latest).length, 1);
  find('#month-view').click();
  card.setConfig({widgets:[widgets[1], {max:100,entity:'sensor.level',type:'gauge'}]});
  await tick();
  assert.equal(find('[data-type="gauge"]'), gauge);
  assert.equal(creations, 4);
  assert.ok(find('.widget-grid[data-count="2"]'));
});

test('a missing helper leaves a local error and can recover on a configuration edit', async t => {
  const config = {widgets:['sensor.temperature'], default_view:'month'};
  const {window, card, find} = setup(t, config);
  await tick();
  assert.match(find('.widget-status').textContent, /Could not load sensor.temperature/);
  assert.equal(find('#month').hidden, false);
  window.loadCardHelpers = async () => ({createCardElement:() => window.document.createElement('ha-card')});
  card.setConfig(config);
  await tick();
  assert.ok(find('.widget-slot ha-card'));
});
