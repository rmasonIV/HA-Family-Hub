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
  assert.equal(find('#month-grid .forecast-icon'), null);
  find('[data-day="20"]').click();
  assert.match(find('#day-events').textContent, /Evening walk/);
  assert.match(find('#day-events').textContent, /8:00/);
  find('#day-events details').open = true;
  callbacks[0]({forecast:[
    {datetime:'2026-11-21T02:00:00Z', condition:'partlycloudy', temperature:72, templow:50},
    {datetime:'2026-11-22', condition:'rainy', temperature:61}
  ]});
  const partlyCloudy = find('[data-day="20"] .forecast-icon');
  const rain = find('[data-day="22"] .forecast-icon');
  assert.equal(partlyCloudy.alt, 'Partly cloudy');
  assert.equal(rain.alt, 'Rainy');
  assert.equal(find('[data-day="21"] .forecast-icon'), null);
  assert.notEqual(partlyCloudy.src, rain.src);
  const svg = Buffer.from(partlyCloudy.src.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /fill="#[0-9a-f]{6}"/i);
  assert.equal(find('#day-weather .forecast-icon').src, partlyCloudy.src);
  assert.equal(find('#day-weather .forecast-icon').alt, '');
  assert.equal(find('#day-events details').open, true);
  assert.equal(find('#day-weather .forecast-condition').textContent, 'Partly cloudy');
  assert.deepEqual([...find('#day-weather .forecast-temperatures').children].map(node => node.textContent.trim()),
    ['50°F', '', '72°F']);
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
  assert.equal(find('#week-days .forecast-icon').src, partlyCloudy.src);
  assert.equal(callbacks.length, 1);
  find('#month-view').click();
  callbacks[0]({forecast:[]});
  assert.equal(find('#month-grid .forecast-icon'), null);
  assert.equal(find('#day-weather').textContent, '');
  card.remove();
  await tick();
  assert.equal(stops(), 1);
});

test('Month with details opens today, follows a day rollover, and allows closing or picking another date', async t => {
  const {window, card, find} = setup(t, {default_view:'month_details'});
  assert.equal(find('#month').hidden, false);
  assert.equal(find('#day-details').hidden, false);
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '20');

  window.Date.now = () => Date.parse('2026-11-21T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('.month-day[aria-current]').dataset.day, '21');
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '21');

  find('[data-day="18"]').click();
  window.Date.now = () => Date.parse('2026-11-22T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '18');

  find('#close-day').click();
  window.Date.now = () => Date.parse('2026-12-01T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('.month-day[aria-current]').dataset.day, '1');
  assert.equal(find('#day-details').hidden, true);
});

test('a pane showing today follows the first day of a new month', async t => {
  const {window, card, find} = setup(t, {default_view:'month_details'});
  window.Date.now = () => Date.parse('2026-11-30T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '30');
  window.Date.now = () => Date.parse('2026-12-01T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '1');
  assert.match(find('#month-title').textContent, /December/);
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

const mealieSettings = {
  calendar:'calendar.mealie_dinner', config_entry_id:'entry-test', url:'https://meals.example.test/mealie', group:'family'
};
const dinnerDay = '2026-11-20';
const dinnerCalendarEvent = summary => ({summary, start:{date:dinnerDay}, end:{date:'2026-11-21'}});
const dinnerRecipe = (name, slug, image = 'cache-key') =>
  ({entry_type:'dinner', mealplan_date:dinnerDay, recipe:{name, slug, recipe_id:'recipe-uuid', image}});

test('Mealie enriches only existing dinner events and shares the lookup between Month and Week', async t => {
  const requests = [];
  const {find, window} = setup(t, {
    default_view:'month_details', calendars:['calendar.mealie_dinner','calendar.family'], mealie:mealieSettings
  }, {
    async callApi(_, path) {
      return path.includes('calendar.mealie_dinner')
        ? ['Chickpea bowls', 'Takeout', 'Soup', 'Ambiguous'].map(dinnerCalendarEvent)
        : [dinnerCalendarEvent('Chickpea bowls')];
    },
    async callWS(message) {
      requests.push(message);
      return {response:{mealplan:[
        dinnerRecipe('Chickpea bowls', 'chickpea-bowls'),
        dinnerRecipe('Soup', 'soup', null),
        dinnerRecipe('Ambiguous', 'first'),
        dinnerRecipe('Ambiguous', 'second'),
        {entry_type:'dinner', mealplan_date:dinnerDay, title:'Takeout', recipe:null}
      ]}};
    }
  });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{
    type:'call_service', domain:'mealie', service:'get_mealplan', return_response:true,
    service_data:{config_entry_id:'entry-test', start_date:dinnerDay, end_date:dinnerDay}
  }]);
  const list = find('#day-events');
  assert.equal(list.querySelectorAll('article').length, 5);
  assert.equal(list.querySelectorAll('.meal-recipe a').length, 2);
  const link = list.querySelector('.meal-recipe a');
  const photo = list.querySelector('.meal-recipe img');
  assert.equal(link.href, 'https://meals.example.test/mealie/g/family/r/chickpea-bowls');
  assert.equal(link.target, '_blank');
  assert.equal(photo.src, 'https://meals.example.test/mealie/api/media/recipes/recipe-uuid/images/min-original.webp');
  photo.dispatchEvent(new window.Event('error'));
  assert.ok(!photo.isConnected && link.isConnected);
  find('#week-view').click();
  find('[data-week-day="4"]').click();
  await tick();
  assert.equal(find('#week-day-events .meal-recipe a').href, link.href);
  assert.equal(requests.length, 1);
});

test('missing permissions and invalid Mealie URLs leave the dinner event readable', async t => {
  const {card, find} = setup(t, {
    default_view:'month_details', calendars:['calendar.mealie_dinner'], mealie:mealieSettings
  }, {
    async callApi() { return [dinnerCalendarEvent('Pasta night')]; },
    async callWS() { throw new Error('Not permitted'); }
  });
  await tick();
  assert.match(find('#day-events').textContent, /Pasta night/);
  assert.match(find('#day-events').textContent, /Recipe details unavailable/);
  card.setConfig({
    default_view:'month_details', calendars:['calendar.mealie_dinner'],
    mealie:{...mealieSettings, url:'javascript:alert(1)'}
  });
  await tick();
  assert.match(find('#config-status').textContent, /Mealie recipe details/);
  assert.match(find('#day-events').textContent, /Pasta night/);
  assert.equal(find('.meal-recipe'), null);
});

test('Week navigation honors Sunday start and keeps browsed weeks through refreshes and view changes', async t => {
  const {window, card, find, calls} = setup(t, {
    calendars:['calendar.family','calendar.school'], week_start:'sunday'
  });
  await tick();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 15');
  assert.match(find('#week-days').textContent, /Evening walk/);
  const currentLabel = find('#week-title').textContent;

  find('#previous-week').click();
  await tick();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 8');
  assert.doesNotMatch(find('#week-days').textContent, /Evening walk/);
  find('#month-view').click();
  find('#week-view').click();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 8');
  find('#next-week').click();
  await tick();
  assert.equal(find('#week-title').textContent, currentLabel);
  assert.match(find('#week-days').textContent, /Evening walk/);

  for (let i = 0; i < 3; i++) find('#next-week').click();
  await tick();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 6');
  assert.ok(calls.some(path => decodeURIComponent(path).includes(
    'start=2026-12-06T06:00:00.000Z&end=2026-12-13T06:00:00.000Z')));
  window.Date.now = () => Date.parse('2026-11-23T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 6');
  find('#current-week').click();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 22');
  window.Date.now = () => Date.parse('2026-11-30T06:01:00Z');
  await card.view.loadCalendar();
  assert.equal(find('[data-week-day="0"]').textContent, 'Sun 29');
});
