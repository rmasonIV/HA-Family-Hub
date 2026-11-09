const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..', 'custom_components', 'family_hub');
const source = fs.readFileSync(path.join(root, 'card', 'family-week-calendar-card.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source boundary ${start}`);
  return source.slice(a, b);
}
function rendering() {
  const escape = section('var __fhEsc = function', 'var __fhT = function');
  const methods = section('_fhBlocksToPreparationHtml(blocks) {', 'async _fhBlobToUploadFromFile(file) {');
  return vm.runInNewContext(`${escape}\n({${methods}})`);
}
test('hostile stored steps render as text, with no image URL interpolation', () => {
  const renderer = rendering();
  const html = renderer._fhRenderStepBlocksHtml([
    { type: 'header', text: '<img src=x onerror="attack()">' },
    { type: 'step', text: '</textarea><svg onload=attack()>' },
    { type: 'image', url: 'https://attacker.invalid/image' },
    null,
  ]);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;/textarea&gt;'));
  assert.ok(!/<(?:img|svg|textarea)\b/i.test(html));
  assert.ok(!html.includes('https://attacker.invalid/image'));
});
test('plain meal preparation text remains readable and bounded', () => {
  const renderer = rendering();
  assert.equal(renderer._fhRenderStepBlocksHtml([{type:'step', text:'Salt & pepper'}, {type:'divider'}]), '<p>Salt &amp; pepper</p><hr>');
  assert.equal((renderer._fhRenderStepBlocksHtml(Array(1000).fill({type:'step', text:'Step'})).match(/<p>/g) || []).length, 200);
});
test('legacy recipe caches and entities are never read on refresh', async () => {
  const method = section('async _fetchRecipes() {', 'async _persistRecipes() {');
  const card = vm.runInNewContext(`({${method}})`, {
    window: new Proxy({}, {get(){throw new Error('Legacy cache must not be read');}}),
  });
  card._recipes = [{name:'Untrusted stale recipe'}];
  card._hass = new Proxy({}, {get(){throw new Error('No API call is expected');}});
  await card._fetchRecipes();
  assert.equal(card._recipes.length, 0);
});
test('excluded menu entries cannot be restored through saved menu order', () => {
  const builtins = section('const FH_MORE_MENU_BUILTINS = [', 'const REMINDER_WEEKDAY_LABELS');
  const keys = vm.runInNewContext(`${builtins}\nFH_MORE_MENU_BUILTINS.map(x => x.key)`);
  for (const key of ['quick_add','recipe_box','suggestions','shopping_list','expiring_soon','low_stock']) assert.ok(!keys.includes(key));
  assert.ok(keys.includes('privacy_mode'));
});
test('excluded standalone cards are inert and show a clear message', () => {
  for (const stem of ['family-hub-recipe-box-card','family-hub-pantry-card','family-hub-companion-card']) {
    const registry = new Map();
    vm.runInNewContext(fs.readFileSync(path.join(root,'card',`${stem}.js`),'utf8'), {
      HTMLElement: class {},
      customElements: {get: key => registry.get(key), define: (key, cls) => registry.set(key, cls)},
      fetch(){throw new Error('No network expected');},
    });
    const card = new (registry.get(stem))();
    card.setConfig({});
    card.hass = new Proxy({}, {get(){throw new Error('No Home Assistant access expected');}});
    assert.match(card.textContent, /disabled/);
  }
});
