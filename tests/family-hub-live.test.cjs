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
  assert.ok(find('#day-weather .range .current'));
  card.hass = {...hass, states:{...hass.states, 'weather.home':{attributes:{temperature:72}}}};
  assert.equal(find('#day-weather .current').style.getPropertyValue('--position'), '0%');
  find('[data-day="22"]').click();
  assert.equal(find('.month-day[aria-current]').dataset.day, '20');
  assert.equal(find('.month-day[aria-expanded="true"]').dataset.day, '22');
  assert.match(find('#day-weather').textContent, /61°F/);
  assert.equal(find('#day-weather .range'), null);
  find('#week-view').click();
  assert.ok(find('#week-days .weather .range'));
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

test('Month emphasizes the current week using the configured start and HA date', t => {
  const {root, find} = setup(t, {default_view:'month', week_start:'sunday'});
  const emphasizedDays = () => [...root.querySelectorAll('.month-day.is-current-week')]
    .map(day => Number(day.dataset.day));
  assert.deepEqual(emphasizedDays(), [15, 16, 17, 18, 19, 20, 21]);
  find('[data-day="25"]').click();
  assert.deepEqual(emphasizedDays(), [15, 16, 17, 18, 19, 20, 21]);
  find('#next-month').click();
  assert.deepEqual(emphasizedDays(), []);
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

test('legacy card titles are ignored while the editor preserves widget titles', t => {
  const config = {title:'Legacy heading', widgets:[{type:'entities', title:'Entry', entities:['sensor.outside']}]};
  const {window, card, root, hass} = setup(t, config);
  assert.equal(Object.hasOwn(card.config, 'title'), false);
  assert.ok(root.querySelector('.calendar-header > #calendar-legend'));
  assert.ok(root.querySelector('.calendar-header > .view-toggle'));
  assert.equal(root.querySelector('.calendar-header h2'), null);

  const editor = card.constructor.getConfigElement();
  editor.setConfig(config);
  editor.hass = hass;
  let saved;
  editor.addEventListener('config-changed', event => { saved = event.detail.config; });
  const picker = editor.querySelector('select:has(option[value="month"])');
  picker.value = 'month';
  picker.dispatchEvent(new window.Event('change'));
  assert.equal(saved.default_view, 'month');
  assert.equal(Object.hasOwn(saved, 'title'), false);
  assert.equal(saved.widgets[0].title, 'Entry');
  assert.equal(config.title, 'Legacy heading');
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
const dinnerRecipe = (name, slug, image = 'cache-key', description = null) =>
  ({entry_type:'dinner', mealplan_date:dinnerDay, recipe:{name, slug, recipe_id:'recipe-uuid', image, description}});

test('Mealie enriches only existing dinner events and shares the lookup between Month and Week', async t => {
  const requests = [];
  const description = 'Roasted chickpeas & <b>lemon</b> over rice.';
  const {find, window} = setup(t, {
    default_view:'month_details', calendars:['calendar.mealie_dinner','calendar.family'], mealie:mealieSettings, daily_briefing:true
  }, {
    async callApi(_, path) {
      return path.includes('calendar.mealie_dinner')
        ? [
          {...dinnerCalendarEvent('Chickpea bowls'), end:{date:dinnerDay}, description},
          ...['Takeout', 'Soup', 'Ambiguous'].map(dinnerCalendarEvent)
        ]
        : [dinnerCalendarEvent('Chickpea bowls')];
    },
    async callWS(message) {
      if (message.type === 'family_hub/assistant/status') return {visible:false};
      requests.push(message);
      return {response:{mealplan:[
        dinnerRecipe('Chickpea bowls', 'chickpea-bowls', 'new + cover', description),
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
  const preview = list.querySelector('.meal-recipe-description');
  assert.equal(link.closest('article').querySelector('strong').textContent, 'Chickpea bowls');
  assert.equal(preview.textContent, description);
  assert.equal(preview.childElementCount, 0);
  assert.equal(list.querySelectorAll('.meal-recipe-description').length, 1);
  assert.equal(link.closest('article').querySelector('.description-preview'), null);
  assert.equal(link.closest('article').querySelector('.description-full').textContent, description);
  assert.equal(list.querySelectorAll('.meal-recipe img').length, 1);
  assert.equal(photo.src, 'https://meals.example.test/mealie/api/media/recipes/recipe-uuid/images/min-original.webp?version=new+%2B+cover');
  photo.dispatchEvent(new window.Event('error'));
  assert.ok(photo.isConnected);
  assert.equal(photo.src, 'https://meals.example.test/mealie/api/media/recipes/recipe-uuid/images/original.webp?version=new+%2B+cover');
  photo.dispatchEvent(new window.Event('error'));
  assert.ok(!photo.isConnected && link.isConnected && preview.isConnected);
  find('#week-view').click();
  find('[data-week-day="4"]').click();
  await tick();
  assert.equal(find('#week-day-events .meal-recipe a').href, link.href);
  assert.equal(find('#week-day-events .meal-recipe-description').textContent, description);
  assert.equal(find('#week-day-details .briefing').hidden, false);
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

test('briefings are opt-in, plain text, shared today and transient for future dates', async t => {
  const calls = [];
  const {card, find, hass} = setup(t, {
    calendars:['calendar.family','calendar.school'], default_view:'month_details', daily_briefing:true
  }, {
    async callWS(message) {
      if (message.type === 'family_hub/assistant/status') return {visible:false};
      calls.push(message);
      if (calls.length > 1) throw new Error('Provider unavailable');
      return {response:{status:'ok', day:'2026-11-21', text:'No events are scheduled.',
        generated_at:'2026-11-21T02:00:00Z'}};
    }
  });
  await tick();
  assert.equal(find('#day-details .briefing').hidden, false);
  assert.match(find('#day-details .briefing-text').textContent, /setup is incomplete/);
  assert.equal(find('#day-details .briefing-refresh').disabled, true);
  hass.states['script.family_hub_generate_briefing'] = {state:'off'};
  hass.states['input_boolean.family_hub_briefing_enabled'] = {state:'off'};
  hass.states['sensor.family_hub_daily_briefing'] = {state:'empty',attributes:{}};
  card.hass = {...hass};
  assert.match(find('#day-details .briefing-text').textContent, /Briefing is off/);
  hass.states['input_boolean.family_hub_briefing_enabled'] = {state:'on'};
  card.hass = {...hass};
  assert.match(find('#day-details .briefing-text').textContent, /No briefing yet/);
  assert.equal(find('#day-details .briefing-refresh').disabled, false);
  hass.states['sensor.family_hub_daily_briefing'].attributes.failure = {day:'2026-11-20',status:'calendar_error'};
  card.hass = {...hass};
  assert.match(find('#day-details .briefing-text').textContent, /Check the calendar IDs/);
  hass.states['sensor.family_hub_daily_briefing'] = {state:'2026-11-20',attributes:{briefing:{
    text:'<img src=x onerror=alert(1)>', generated_at:'2026-11-20T11:00:00Z'
  }}};
  card.hass = {...hass};
  assert.equal(find('#day-details .briefing-text').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(find('#day-details .briefing-text img'), null);
  assert.equal(find('#day-details time').hidden, false);
  assert.equal(calls.length, 0);

  find('[data-day="21"]').click();
  assert.match(find('#day-events').textContent, /No events/);
  find('#day-details .briefing-refresh').click();
  await tick();
  assert.equal(calls[0].return_response, true);
  assert.equal(calls[0].service_data.briefing_date, '2026-11-21');
  assert.match(find('#day-details .briefing-text').textContent, /No events are scheduled/);
  find('#day-details .briefing-refresh').click();
  await tick();
  assert.match(find('#day-details .briefing-text').textContent, /could not be updated/);
  assert.match(find('#day-events').textContent, /No events/);

  find('[data-day="20"]').click();
  assert.equal(find('#day-details .briefing-text').textContent, '<img src=x onerror=alert(1)>');
  find('[data-day="19"]').click();
  assert.equal(find('#day-details .briefing').hidden, true);

  card.setConfig({calendars:['calendar.family'], default_view:'month_details'});
  assert.equal(find('#day-details .briefing').hidden, true);
});

test('timed overlaps appear independently of AI and exclude adjoining and all-day events', async t => {
  const timed = (summary, start, end) => ({
    summary, start:{dateTime:`2026-11-20T${start}:00-06:00`},
    end:{dateTime:`2026-11-20T${end}:00-06:00`}
  });
  const {find} = setup(t, {calendars:['calendar.family'], default_view:'month_details'}, {
    async callApi() {
      return [timed('Appointment', '08:00', '09:00'), timed('Practice','08:30','09:30'),
        timed('Shopping','09:30','10:00'),
        {summary:'Holiday',start:{date:'2026-11-20'},end:{date:'2026-11-21'}}];
    }
  });
  await tick();
  assert.equal(find('#day-details .briefing').hidden, true);
  assert.equal(find('#day-details .overlaps li').textContent, 'Appointment overlaps Practice');
  assert.equal(find('#day-details .overlaps ul').children.length, 1);
});

test('integration settings enable briefings without card YAML or package entities', async t => {
  const requests = [];
  let briefingStatus;
  let unsubscribed = false;
  const {card, find, hass} = setup(t, {calendars:['calendar.family','calendar.school'], default_view:'month_details'}, {
    locale:{language:'en-US', time_format:'language'},
    connection:{async subscribeMessage(callback, request) {
      assert.equal(request.type, 'family_hub/briefing/subscribe');
      briefingStatus = callback;
      return () => { unsubscribed = true; };
    }},
    async callWS(request) {
      if (request.type === 'family_hub/assistant/status') return {visible:false};
      requests.push(request);
      return {status:'ok', day:request.day, text:'A sample briefing.', generated_at:'2026-11-21T02:00:00Z'};
    }
  });
  await tick();
  const section = find('#day-details .briefing');
  const button = section.querySelector('button');
  assert.equal(section.hidden, true);
  briefingStatus({mode:'ready', revision:'first', calendars:['calendar.family']});
  assert.match(section.querySelector('.briefing-scope').textContent, /Briefing calendars: Family/);
  assert.match(section.querySelector('.briefing-scope').textContent, /outside the briefing scope/);
  assert.equal(section.hidden, false);
  assert.equal(button.disabled, false);
  button.click();
  await tick();
  assert.equal(requests[0].type, 'family_hub/briefing/generate');
  assert.equal(requests[0].day, '2026-11-20');
  assert.match(section.textContent, /A sample briefing/);
  const timestamp = section.querySelector('time');
  assert.equal(timestamp.dateTime, '2026-11-21T02:00:00Z');
  assert.equal(timestamp.textContent, 'Generated 11/20/26, 8:00 PM');
  card.hass = {...hass, locale:{language:'en-GB', time_format:'language'}};
  assert.equal(timestamp.textContent, 'Generated 20/11/2026, 20:00');
  card.hass = {...hass, locale:{language:'en-US', time_format:'24'}};
  assert.equal(timestamp.textContent, 'Generated 11/20/26, 20:00');
  card.hass = {...hass, locale:{language:'en', time_format:'language'},
    config:{...hass.config, country:'GB'}};
  assert.equal(timestamp.textContent, 'Generated 20/11/2026, 20:00');
  assert.equal(timestamp.dateTime, '2026-11-21T02:00:00Z');

  briefingStatus({mode:'ready', revision:'second'});
  assert.doesNotMatch(section.textContent, /A sample briefing/);
  briefingStatus({mode:'disabled'});
  assert.equal(section.hidden, true);
  card.remove();
  await tick();
  assert.equal(unsubscribed, true);
});

test('calendar appearance is optional, independent and safe to reconfigure', async t => {
  const config = {
    type:'custom:family-hub-live', calendars:['calendar.family','calendar.school'],
    calendar_colors:{'calendar.family':'#a43560'}, default_view:'month_details',
    actions:['light.office'], widgets:['light.office']
  };
  const {card, find} = setup(t, config);
  await tick();
  assert.equal(find('.calendar-surround'), null);
  assert.equal(find('.calendar').parentElement.id, 'layout');

  for (const [frame, seasonal_accent] of [
    ['retro_tv','off'], ['off','christmas_retro'], ['retro_tv','christmas_retro']
  ]) {
    card.setConfig({...config, appearance:{frame, seasonal_accent}});
    await tick();
    const surround = find('.calendar-surround');
    assert.equal(surround.dataset.frame, frame);
    assert.equal(surround.dataset.seasonalAccent, seasonal_accent);
    assert.equal(surround.querySelectorAll('.tv-antenna').length, frame === 'off' ? 0 : 1);
    assert.equal(surround.querySelectorAll('.christmas-holly').length, seasonal_accent === 'off' ? 0 : 2);
    assert.ok([...surround.querySelectorAll('svg')].every(svg => svg.getAttribute('aria-hidden') === 'true'));
    assert.equal(find('.calendar').parentElement, surround);
    assert.equal(find('#widget-panel').parentElement.id, 'layout');
    assert.ok(find('#quick-controls .quick-control'));
    assert.match(find('#day-events').textContent, /Evening walk/);
    assert.equal(find('#month-grid [style*="#a43560"]').style.getPropertyValue('--event-color'), '#a43560');
    find('#week-view').click();
    assert.equal(find('#week').hidden, false);
    find('#next-week').click();
    await tick();
    find('#month-view').click();
    assert.equal(find('#month').hidden, false);
  }

  card.setConfig({...config, appearance:{frame:'constructor', seasonal_accent:'christmas_retro'}});
  assert.equal(find('.calendar-surround').dataset.frame, 'off');
  assert.match(find('#config-status').textContent, /appearance\.frame/);
  card.setConfig({...config, appearance:['retro_tv']});
  assert.equal(find('.calendar-surround'), null);
  assert.match(find('#config-status').textContent, /appearance must be a mapping/);
  card.setConfig({...config, appearance:{frame:false, seasonal_accent:'off'}});
  assert.equal(find('.calendar-surround'), null);
  assert.equal(find('#config-status').hidden, true);
});

test('visual editor changes one appearance setting and preserves the other card options', t => {
  const {card, hass} = setup(t, {});
  const editor = card.constructor.getConfigElement();
  const config = {appearance:{frame:'retro_tv', seasonal_accent:'christmas_retro'}, daily_briefing:true};
  editor.setConfig(config);
  editor.hass = hass;
  const [frame, accent] = [...editor.querySelectorAll('fieldset')].find(
    fieldset => fieldset.querySelector('legend').textContent === 'Calendar appearance'
  ).querySelectorAll('select');
  assert.equal(frame.value, 'retro_tv');
  assert.equal(accent.value, 'christmas_retro');
  let saved;
  editor.addEventListener('config-changed', event => { saved = event.detail.config; });
  frame.value = 'off';
  frame.onchange();
  assert.equal(saved.appearance.frame, 'off');
  assert.equal(saved.appearance.seasonal_accent, 'christmas_retro');
  assert.equal(saved.daily_briefing, true);
});

test('Assistant reviews a text-only proposal and confirms just its ID once', async t => {
  const requests = [];
  let resolveSave;
  let calendarEvents = [];
  let calendarReads = 0;
  const event = {summary:'<img src=x>', start_date_time:'2026-11-27T18:00:00-06:00',
    end_date_time:'2026-11-27T20:00:00-06:00', description:'Bring water'};
  const {find, window} = setup(t, {calendars:['calendar.family'], default_view:'month_details'}, {
    async callApi() {
      calendarReads++;
      return calendarEvents;
    },
    async callWS(message) {
      switch (message.type) {
        case 'family_hub/assistant/status':
          return {visible:true, configured:true, calendars:{'calendar.family':'Family'}};
        case 'family_hub/assistant/propose':
          requests.push(message);
          return {
            status:'proposal', id:'test-id', calendar:'Family', timezone:'America/Chicago',
            default_minutes:null, event,
          };
        case 'family_hub/assistant/confirm':
          requests.push(message);
          return new Promise(resolve => { resolveSave = resolve; });
        default:
          throw new Error(message.type);
      }
    }
  });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  await tick();
  assert.equal(find('#assistant-open').hidden, false);
  find('#assistant-open').click();
  find('#assistant-request').value = 'Practice Friday at 6 PM for two hours';
  find('#assistant-propose').click();
  await tick();
  assert.equal(requests.length, 1);
  const preview = find('#assistant-preview');
  assert.equal(preview.querySelector('img'), null);
  assert.match(preview.textContent, /<img src=x>[\s\S]*Family[\s\S]*120 minutes[\s\S]*Bring water/);
  find('#assistant-confirm').click();
  find('#assistant-confirm').click();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    type:'family_hub/assistant/confirm', proposal_id:'test-id',
  });
  assert.equal(requests.length, 2);
  const readsBeforeConfirmation = calendarReads;
  const timers = new Map();
  window.setTimeout = (callback, delay) => {
    const id = timers.size + 1;
    timers.set(id, {callback, delay});
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  resolveSave({status:'created', calendar_id:'calendar.family', event});
  await tick();
  assert.equal(find('#assistant-dialog').open, false);
  assert.equal(find('#assistant-notice').textContent, 'Event created.');
  assert.ok(calendarReads > readsBeforeConfirmation);
  find('[data-day="27"]').click();
  assert.match(find('#day-events').textContent, /<img src=x>/);
  assert.equal(find('#day-events').querySelector('img'), null);

  const retry = [...timers.values()].find(timer => timer.delay === 2000);
  assert.ok(retry);
  calendarEvents = [{summary:event.summary, description:event.description,
    start:{dateTime:'2026-11-28T00:00:00Z'}, end:{dateTime:'2026-11-28T02:00:00Z'}}];
  window.Date.now = () => Date.parse('2026-11-21T02:00:02Z');
  retry.callback();
  await tick();
  assert.equal(find('#day-events').textContent.split(event.summary).length - 1, 1);
  assert.ok(![...timers.values()].some(timer => timer.delay === 3000));
  assert.equal(requests.length, 2);
});

const thermostatId = 'climate.smart_thermostat_250721009116476012';
const switchId = 'switch.living_room';

function setupThermostat(t, callService) {
  const {card, root, hass} = setup(t, {
    actions:[switchId, thermostatId],
    action_appearance:{[thermostatId]:{name:'Thermostat'}}
  }, {callService});
  const attributes = {
    friendly_name:'Wall Thermostat', current_temperature:19.5, temperature:20,
    min_temp:18, max_temp:21, target_temp_step:0.5, temperature_unit:'°C',
    supported_features:3, hvac_modes:['heat','cool','heat_cool','off','auto']
  };
  function publish(state, overrides = {}) {
    card.hass = {...hass, states:{...hass.states,
      [switchId]:{state:'off', attributes:{friendly_name:'Living room'}},
      [thermostatId]:{state, attributes:{...attributes, ...overrides}}
    }};
  }
  publish('heat');
  const tile = root.querySelector('.quick-climate');
  const buttons = key => [...tile.querySelectorAll('.quick-climate-setpoint')][key].querySelectorAll('button');
  return {card, tile, buttons, publish, toggle:root.querySelector('button.quick-control')};
}

test('thermostat displays reported values, applies its step and limits, and preserves switch toggles', async t => {
  const requests = [];
  let finish;
  const {buttons, tile, toggle, publish} = setupThermostat(t, (...args) => {
    requests.push(JSON.parse(JSON.stringify(args)));
    if (args[0] === 'climate') return new Promise(resolve => { finish = resolve; });
  });
  const [decrease, increase] = buttons(0);
  assert.equal(tile.getAttribute('aria-label'), 'Thermostat');
  assert.match(tile.textContent, /Indoor 19.5°C.*Target20°C/);
  assert.equal(increase.getAttribute('aria-label'), 'Increase Thermostat target');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  toggle.click();
  increase.click();
  assert.equal(decrease.disabled, true);
  assert.equal(increase.disabled, true);
  increase.click();
  assert.deepEqual(requests, [
    ['switch','toggle',{entity_id:switchId}],
    ['climate','set_temperature',{entity_id:thermostatId, temperature:20.5}]
  ]);
  finish();
  await tick();
  assert.match(tile.textContent, /Target20°C/);
  publish('heat', {temperature:21, current_temperature:20});
  assert.match(tile.textContent, /Indoor 20°C.*Target21°C/);
  assert.equal(increase.disabled, true);
  assert.equal(decrease.disabled, false);
  publish('heat', {temperature:18});
  assert.equal(decrease.disabled, true);
});

test('the thermostat heading opens HA details independently of its stepper', async t => {
  const details = [];
  const requests = [];
  const {card, tile, buttons} = setupThermostat(t, (...args) => requests.push(args));
  card.addEventListener('hass-more-info', event => details.push(event.detail.entityId));
  const heading = tile.querySelector('.quick-climate-heading');
  assert.equal(heading.getAttribute('aria-label'), 'Open Thermostat details. Indoor 19.5°C');
  heading.click();
  assert.deepEqual(details, [thermostatId]);
  assert.equal(requests.length, 0);
  buttons(0)[1].click();
  await tick();
  assert.equal(requests.length, 1);
  assert.deepEqual(details, [thermostatId]);
});

test('thermostat supports range mode, read-only modes, missing features, and service failures', async t => {
  const requests = [];
  const {buttons, tile, publish} = setupThermostat(t, async (...args) => {
    requests.push(JSON.parse(JSON.stringify(args)));
    if (requests.length === 1) throw new Error('Service unavailable');
  });
  for (const mode of ['off','auto','unavailable','unknown']) {
    publish(mode);
    assert.equal(buttons(0)[1].disabled, true, mode);
  }
  assert.match(tile.textContent, /Unavailable/);
  publish('cool', {hvac_modes:['heat']});
  assert.equal(buttons(0)[1].disabled, true);
  publish('cool', {supported_features:2});
  assert.equal(buttons(0)[1].disabled, true);
  publish('cool', {temperature:null});
  assert.equal(buttons(0)[1].disabled, true);
  publish('heat_cool', {target_temp_low:19, target_temp_high:20, temperature_unit:undefined});
  assert.match(tile.textContent, /Low target19°F.*High target20°F/);
  const increaseLow = buttons(1)[1];
  increaseLow.click();
  await tick();
  const status = tile.querySelector('[role=status]');
  assert.equal(status.textContent, 'Could not set the temperature.');
  assert.equal(status.hidden, false);
  assert.equal(increaseLow.disabled, false);
  increaseLow.click();
  await tick();
  assert.equal(status.hidden, true);
  assert.deepEqual(requests, Array.from({length:2}, () =>
    ['climate','set_temperature',{entity_id:thermostatId, target_temp_low:19.5, target_temp_high:20}]
  ));
  publish('heat_cool', {target_temp_low:19.5, target_temp_high:20});
  assert.equal(increaseLow.disabled, true);
  assert.equal(buttons(2)[0].disabled, true);
});

test('the Quick Actions editor offers climate entities alongside switches', t => {
  const {window, hass} = setup(t, {actions:[switchId]});
  const editor = window.customElements.get('family-hub-live').getConfigElement();
  editor.setConfig({actions:[switchId]});
  editor.hass = {...hass, states:{...hass.states,
    [switchId]:{attributes:{friendly_name:'Living room'}},
    [thermostatId]:{attributes:{friendly_name:'Thermostat'}}
  }};
  const picker = editor.querySelector('[aria-label="Choose quick actions entity"]');
  assert.ok([...picker.options].some(option => option.value === thermostatId));
  assert.ok(![...picker.options].some(option => option.value === switchId));
  let config;
  editor.addEventListener('config-changed', event => { config = event.detail.config; });
  picker.value = thermostatId;
  picker.dispatchEvent(new window.Event('change'));
  picker.nextElementSibling.click();
  assert.deepEqual(Array.from(config.actions), [switchId, thermostatId]);
});

test('image-only Assistant keeps missing times blank and reviews edits before creating', async t => {
  const requests = [];
  const event = {
    summary:'Edited workshop', start_date_time:'2026-12-05T14:00:00-06:00',
    end_date_time:'2026-12-05T15:30:00-06:00',
  };
  const {find, window} = setup(t, {calendars:['calendar.family']}, {
    async fetchWithAuth(path, {method, body}) {
      requests.push({path, method, file:body.name});
      return {
        ok:true,
        json:async () => ({
          status:'draft', timezone:'America/Chicago', draft:{
            title:'Workshop', start:'2026-12-05', end:'', all_day:false,
            duration_minutes:0, confidence:'low', ambiguities:'<img src=x> Time is missing.',
            location:'Library', description:'',
          },
        }),
      };
    },
    async callWS(message) {
      switch (message.type) {
        case 'family_hub/assistant/status':
          return {visible:true, vision_configured:true, calendars:{'calendar.family':'Family'}};
        case 'family_hub/assistant/review_image_event':
          requests.push(message);
          return {status:'proposal', id:'image-proposal', calendar:'Family', timezone:'America/Chicago', event};
        case 'family_hub/assistant/confirm':
          requests.push(message);
          return {status:'created', calendar_id:'calendar.family', event};
        default:
          throw new Error(message.type);
      }
    },
  });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  await tick();
  find('#assistant-open').click();
  assert.equal(find('#assistant-request-label').hidden, true);
  const input = find('#assistant-image');
  assert.equal(find('#assistant-image-label').hidden, false);
  Object.defineProperty(input, 'files', {
    value:[new window.File(['sample'], 'flyer.png', {type:'image/png'})],
  });
  input.dispatchEvent(new window.Event('change'));
  find('#assistant-propose').click();
  await tick();
  assert.deepEqual(requests, [{path:'/api/family_hub/assistant/image', method:'POST', file:'flyer.png'}]);
  assert.equal(find('#assistant-draft').hidden, false);
  assert.equal(find('#assistant-confirm').hidden, true);
  assert.equal(find('#assistant-start-date').value, '2026-12-05');
  assert.equal(find('#assistant-start-time').value, '');
  assert.equal(find('#assistant-draft-note').querySelector('img'), null);
  assert.match(find('#assistant-draft-note').textContent, /Time is missing/);

  find('#assistant-draft-title').value = 'Edited workshop';
  find('#assistant-start-time').value = '14:00';
  find('#assistant-duration').value = '90';
  find('#assistant-propose').click();
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].type, 'family_hub/assistant/review_image_event');
  assert.equal(requests[1].event.start, '2026-12-05T14:00');
  assert.equal(requests[1].event.duration_minutes, 90);
  assert.match(find('#assistant-preview').textContent, /Edited workshop/);
  find('#assistant-confirm').click();
  await tick();
  assert.equal(requests[2].type, 'family_hub/assistant/confirm');
  assert.equal(requests[2].proposal_id, 'image-proposal');
});
