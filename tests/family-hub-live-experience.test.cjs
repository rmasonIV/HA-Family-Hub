const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const {JSDOM} = require(process.env.JSDOM_PATH || 'jsdom');

const source = readFileSync(join(__dirname,'../custom_components/family_hub/card/family-hub-live.js'),'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function mount(t, overrides = {}, {browser = false} = {}) {
  const dom = new JSDOM('', {runScripts:'outside-only',url:'http://localhost/'});
  t.after(() => dom.window.close());
  dom.window.Date.now = () => Date.parse('2026-11-21T02:00:00Z');
  dom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
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
  const browseCalls = [];
  let detailsCalls = 0;
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
      if (req.type === 'family_hub/mealie_read' && req.operation === 'settings') {
        return {calendar:'calendar.mealie_dinner', url:'https://meals.example.test', group:'family', browse:browser};
      }
      if (req.operation === 'search' || req.operation === 'favorites') {
        browseCalls.push(req);
        const count = req.operation === 'favorites' ? 1 : 10;
        return {items:Array.from({length:count},(_,i)=>({name:'Recipe '+i,slug:'recipe-'+i}))};
      }
      if (req.operation === 'recipe' || req.service === 'get_recipe') {
        detailsCalls++;
        const response = {recipe:{ingredients:[{display:'<img src=x> Rice'}],instructions:[{text:'Cook rice.'}]}};
        return req.domain === 'mealie' ? {response} : response;
      }
      if (req.domain === 'mealie' || req.operation === 'mealplan') {
        mealCalls++;
        const response = {mealplan:[{mealplan_date:'2026-11-20',entry_type:'dinner',
          recipe:{name:'Turkey dinner',slug:'turkey-dinner',recipe_id:'recipe-1',image:null}}]};
        return req.domain === 'mealie' ? {response} : response;
      }
      throw Error('Unexpected call');
    }
  };
  dom.window.document.body.append(card);
  return {card,root:card.shadowRoot,browseCalls,get mealCalls(){return mealCalls;},get detailsCalls(){return detailsCalls;}};
}

test('filled accessible calendar legend retains existing isolation and contrast',async t=>{
  const {root}=mount(t);
  await flush();
  const buttons=[...root.querySelectorAll('#calendar-legend button')];
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].style.getPropertyValue('--legend-ink'),'#172334');
  assert.equal(buttons[0].querySelector('.legend-label').textContent,buttons[0].textContent);
  assert.match(source,/\.calendar-legend button\{[^}]+min-height:44px;min-width:44px/);
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
  // Limit the upcoming-event widget to the Family calendar; the Mealie all-day event starts earlier.
  root.querySelector('#calendar-legend button').click();
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


test('integration Mealie settings populate the widget without legacy card YAML',async t=>{
  const {root}=mount(t,{mealie:undefined});
  await flush();
  const dinner=root.querySelectorAll('.household-widget')[2];
  assert.equal(dinner.querySelector('a')?.href,'https://meals.example.test/g/family/r/turkey-dinner');
});


test('recipe browser pages cached searches, reads favorites, and reuses recipe details',async t=>{
  const fixture=mount(t,{mealie:undefined,recipe_browser:true},{browser:true});
  const {root,browseCalls}=fixture;
  await flush();
  const opener=root.querySelector('#open-recipe-browser');
  assert.equal(opener.hidden,false);
  opener.click();
  const browser=root.querySelector('#recipe-browser');
  assert.equal(browser.open,true);
  browser.querySelector('input').value='Rice';
  browser.querySelector('form').dispatchEvent(new fixture.card.ownerDocument.defaultView.Event('submit',{cancelable:true}));
  await flush();
  assert.equal(browser.querySelectorAll('li').length,8);
  browser.querySelector('.recipe-next').click();
  await flush();
  assert.equal(browser.querySelectorAll('li').length,2);
  assert.equal(browseCalls.length,1);
  browser.querySelector('.recipe-favorites').click();
  await flush();
  assert.deepEqual(browseCalls.map(call=>call.operation),['search','favorites']);
  browser.querySelector('li button').click();
  await flush();
  const detail=root.querySelector('#recipe-details');
  assert.equal(detail.open,true);
  assert.equal(detail.querySelector('li').textContent,'<img src=x> Rice');
  assert.equal(detail.querySelector('img'),null);
  detail.querySelector('button').click();
  assert.equal(browser.open,true);
  browser.querySelector('li button').click();
  await flush();
  assert.equal(fixture.detailsCalls,1);
});
