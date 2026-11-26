const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');

const source = readFileSync(join(__dirname,'../custom_components/family_hub/card/family-hub-live.js'),'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function mount(t, overrides = {}) {
  const dom = new JSDOM('', {runScripts:'outside-only',url:'http://localhost/'});
  t.after(() => dom.window.close());
  dom.window.Date.now = () => Date.parse('2026-11-21T02:00:00Z');
  dom.window.eval(source);
  const card = dom.window.document.createElement('family-hub-live');
  const data = {
    'calendar.family': [
      {summary:'<img src=x onerror=alert(1)>',start:{dateTime:'2026-11-21T03:00:00Z'},end:{dateTime:'2026-11-21T04:00:00Z'}},
      {summary:'Old event',start:{dateTime:'2026-11-20T01:00:00Z'},end:{dateTime:'2026-11-20T02:00:00Z'}}
    ],
    'calendar.mealie_dinner': [
      {summary:'Turkey dinner',start:{date:'2026-11-20'},end:{date:'2026-11-20'}}
    ]
  };
  let mealCalls = 0;
  card.setConfig({calendars:['calendar.family','calendar.mealie_dinner'],default_view:'month_details',
    mealie:{calendar:'calendar.mealie_dinner',config_entry_id:'entry-test',url:'https://meals.example.test',group:'family'},
    widgets:[{type:'upcoming-event'},{type:'countdown'},{type:'tonights-dinner'}],...overrides});
  card.hass = {
    config:{time_zone:'America/Chicago'},
    states:{
      'calendar.family':{attributes:{friendly_name:'Family'}},
      'calendar.mealie_dinner':{attributes:{friendly_name:'Dinner'}}
    },
    async callApi(_method,path) {return data[decodeURIComponent(path.split('/')[1].split('?')[0])] || [];},
    async callWS(req) {
      if (req.domain === 'mealie') {
        mealCalls++;
        return {response:{mealplan:[{mealplan_date:'2026-11-20',entry_type:'dinner',
          recipe:{name:'Turkey dinner',slug:'turkey-dinner',recipe_id:'recipe-1',image:null}}]}};
      }
      throw Error('Unexpected call');
    }
  };
  dom.window.document.body.append(card);
  return {card,root:card.shadowRoot,get mealCalls(){return mealCalls;}};
}

test('filled accessible calendar legend retains existing isolation and contrast',async t=>{
  const {root}=mount(t);
  await flush();
  const buttons=[...root.querySelectorAll('#calendar-legend button')];
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].style.getPropertyValue('--legend-ink'),'#172334');
  assert.match(source,/background:var\(--event-color\);color:var\(--legend-ink\)/);
  buttons[0].click();
  assert.equal(buttons[1].hasAttribute('data-inactive'),true);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  assert.doesNotMatch(root.querySelector('#month-grid').textContent,/Turkey dinner/);
  buttons[0].click();
  assert.equal(buttons[1].hasAttribute('data-inactive'),false);
  assert.match(root.querySelector('#month-grid').textContent,/Turkey dinner/);
});

test('past event styling and upcoming/countdown widgets escape calendar data',async t=>{
  const {root}=mount(t);
  await flush();
  assert.ok(root.querySelector('#month-grid .is-past'));
  assert.match(root.querySelector('.household-widget').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(root.querySelector('.household-widget img'),null);
  const widgets=root.querySelectorAll('.household-widget');
  assert.match(widgets[0].textContent,/In 1 hr/);
  const picker=widgets[1].querySelector('select');
  assert.ok(picker);
  assert.equal(picker.getAttribute('aria-label'),'Select countdown event');
  assert.ok(picker.options.length>=1);
});

test('dinner widget reuses Mealie lookup and ignores unsafe widget types',async t=>{
  const {card,root}=mount(t);
  await flush();
  await flush();
  const dinner=root.querySelectorAll('.household-widget')[2];
  assert.match(dinner.textContent,/Turkey dinner/);
  assert.equal(dinner.querySelector('a')?.href,'https://meals.example.test/g/family/r/turkey-dinner');
  card.setConfig({calendars:['calendar.family'],widgets:[{type:'countdown',event:'<script>alert(1)</script>'},
    {type:'custom:evil'},{type:'upcoming-event'}]});
  assert.equal(card.config.widgets.length,2);
});
