const assert = require('node:assert/strict');
const {join} = require('node:path');
const {test} = require('node:test');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const url = pathToFileURL(join(__dirname, 'live.html'));
url.search = '?capture&frame=retro_tv&seasonal_accent=christmas_retro';

test('the calendar stays usable inside the frame from phone to wall display', async t => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  t.after(() => browser.close());
  const touch = await browser.newContext({hasTouch:true});
  for (const [width, height] of [[320,568],[390,844],[768,1024],[1366,768],[1920,1080],[2560,1440]]) {
    await t.test(width+'×'+height, async t => {
      const page = await touch.newPage();
      t.after(() => page.close());
      await page.setViewportSize({width, height});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https?:/, route => route.abort());
      await page.goto(url.href);
      const calendar = page.locator('.calendar');
      const surround = page.locator('.calendar-surround');
      const antenna = surround.locator('.tv-antenna');
      await calendar.locator('#month-grid .event').first().waitFor();
      const assertFit = async () => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(await calendar.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        const screen = await calendar.boundingBox();
        const outer = await surround.boundingBox();
        const aerial = await antenna.boundingBox();
        assert.ok(screen.x > outer.x && screen.x + screen.width < outer.x + outer.width);
        assert.ok(Math.abs(aerial.y + aerial.height - outer.y) <= 1);
        for (const holly of await surround.locator('.christmas-holly').all()) {
          const sprig = await holly.boundingBox();
          assert.ok(sprig.y + sprig.height <= screen.y + 1);
        }
      };
      await assertFit();
      await calendar.locator('.month-day[data-day="10"]').tap();
      assert.ok(await calendar.locator('#day-details').isVisible());
      await assertFit();
      await calendar.locator('#week-view').tap();
      await calendar.locator('#week-days .forecast-icon').first().waitFor();
      await assertFit();
      await calendar.locator('.day-heading').first().tap();
      assert.ok(await page.locator('#week-day-details').isVisible());
      await page.locator('#week-day-details button[aria-label="Close day details"]').tap();
      assert.ok(await page.locator('#widget-panel strong').last().isVisible());
      assert.deepEqual(errors, []);
    });
  }
});

test('Quick Actions stay compact and keep thermostat targets usable on touch displays', async t => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  t.after(() => browser.close());
  const page = await browser.newPage({hasTouch:true, viewport:{width:1366,height:768}});
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(join(__dirname, 'live.html')).href);
  await page.locator('#month-grid .event').first().waitFor();
  await page.locator('family-hub-live').evaluate(card => {
    const id = 'climate.demo';
    card.hass = {...card.hass, states:{...card.hass.states, [id]:{
      state:'heat', attributes:{
        friendly_name:'Thermostat', current_temperature:70, temperature:72,
        min_temp:55, max_temp:85, supported_features:3, hvac_modes:['heat','heat_cool']
      }
    }}};
    card.setConfig({...card.config, actions:['light.living_room', id], ribbon_default:'expanded'});
  });
  const ribbon = page.locator('#quick-actions');
  const light = ribbon.locator('button.quick-control');
  const climate = ribbon.locator('.quick-climate');
  const heading = climate.locator('.quick-climate-heading');
  const assertStepper = async row => {
    const minus = await row.locator('button').first().boundingBox();
    const plus = await row.locator('button').last().boundingBox();
    const target = await row.locator('.quick-climate-value').boundingBox();
    for (const button of [minus, plus]) {
      assert.equal(button.width, 44);
      assert.equal(button.height, 44);
    }
    assert.ok(Math.abs(minus.x + minus.width + 4 - target.x) < 1);
    assert.ok(Math.abs(target.x + target.width + 4 - plus.x) < 1);
  };
  await assertStepper(climate.locator('.quick-climate-setpoint:visible'));
  const wide = await ribbon.boundingBox();
  const tile = await climate.boundingBox();
  assert.ok(wide.height <= 130);
  assert.equal(tile.y, (await light.boundingBox()).y);
  assert.ok(tile.x + tile.width < wide.x + wide.width / 2);
  assert.ok((await heading.boundingBox()).x < tile.x + tile.width / 2);
  const activeDay = await page.locator('.month-day.is-current-week').first().boundingBox();
  const otherDay = await page.locator('.month-day:not(.is-current-week)').first().boundingBox();
  assert.ok(activeDay.height >= otherDay.height + 5);

  await page.locator('family-hub-live').evaluate(card => {
    const id = 'climate.demo';
    const entity = card.hass.states[id];
    card.hass = {...card.hass, states:{...card.hass.states, [id]:{
      state:'heat_cool', attributes:{...entity.attributes, target_temp_low:67, target_temp_high:75,
        friendly_name:'Upstairs Hallway Thermostat'}
    }}};
  });
  const [low, high] = await climate.locator('.quick-climate-setpoint:visible').all();
  assert.equal((await low.boundingBox()).y, (await high.boundingBox()).y);
  assert.ok((await ribbon.boundingBox()).height <= wide.height + 2);

  await page.setViewportSize({width:320, height:568});
  const narrow = await climate.boundingBox();
  assert.ok(narrow.y >= (await light.boundingBox()).y + (await light.boundingBox()).height);
  assert.ok(narrow.x + narrow.width <= 320);
  const rows = await climate.locator('.quick-climate-setpoint:visible').all();
  assert.equal(rows.length, 2);
  for (const row of rows) await assertStepper(row);
  await ribbon.locator('#quick-toggle').tap();
  assert.equal(await climate.isVisible(), false);
  const previews = ribbon.locator('.quick-previews');
  const [lightPreview, thermostatPreview] = await previews.getByRole('button').all();
  const lightBox = await lightPreview.boundingBox();
  const thermostatBox = await thermostatPreview.boundingBox();
  assert.equal(lightBox.y, thermostatBox.y);
  assert.ok(lightBox.height >= 44);
  assert.ok(await previews.evaluate(element => element.scrollWidth > element.clientWidth));
  assert.ok((await ribbon.boundingBox()).height < wide.height);
  await thermostatPreview.tap();
  assert.equal(await climate.isVisible(), true);
  await ribbon.locator('#quick-toggle').press('Space');
  await lightPreview.press('Enter');
  assert.equal(await climate.isVisible(), true);
  assert.equal(await ribbon.locator('#quick-toggle').evaluate(button =>
    button.getRootNode().activeElement === button), true);
});

test('Mealie recipe opens above the calendar and leaves the selected day in place', async t => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  t.after(() => browser.close());
  const page = await browser.newPage({hasTouch:true, viewport:{width:390,height:844}});
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(join(__dirname, 'live.html')).href+'?mealie');
  const calendar = page.locator('.calendar');
  const header = page.locator('.quick-header');
  await page.locator('#quick-toggle').tap();
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'),'false');
  const box = await header.boundingBox();
  await page.touchscreen.tap(box.x+box.width-2,box.y+box.height/2);
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'),'true');
  const label = page.locator('#calendar-legend button').first();
  assert.ok((await label.boundingBox()).height >= 44);
  assert.ok((await label.locator('.legend-label').boundingBox()).height < 44);
  const widget = page.locator('.household-widget').filter({hasText:"Tonight's dinner"});
  const trigger = widget.getByRole('button',{name:/View recipe/});
  await trigger.waitFor();
  assert.equal(await trigger.count(), 1);
  assert.match(await widget.textContent(), /Leftovers/);
  const dimensions = await calendar.evaluate(node => [node.offsetWidth, node.offsetHeight]);
  await trigger.tap();
  const recipe = page.locator('#recipe-details');
  await recipe.getByText('Chickpeas',{exact:true}).waitFor();
  assert.deepEqual(await calendar.evaluate(node => [node.offsetWidth, node.offsetHeight]),dimensions);
  assert.equal(await page.evaluate(() => window.familyHubRecipeDialogs.size),1);
  await page.keyboard.press('Escape');
  await recipe.waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(node => node.getRootNode().activeElement === node),true);
  const selected = page.locator('.month-day[aria-expanded="true"]');
  assert.equal(await selected.getAttribute('data-day'),'10');
  await page.locator('#day-details').getByRole('button',{name:/View recipe/}).tap();
  await recipe.getByText('Chickpeas',{exact:true}).waitFor();
  await recipe.getByRole('button',{name:'Close recipe'}).tap();
  await recipe.waitFor({state:'hidden'});
  await page.locator('#week-view').tap();
  await page.getByRole('button',{name:/Wed 10/}).tap();
  const week = page.locator('#week-day-details');
  await week.getByRole('button',{name:/View recipe/}).tap();
  await recipe.getByText('Chickpeas',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await recipe.waitFor({state:'hidden'});
  assert.ok(await week.isVisible());
  assert.equal(await page.evaluate(() => window.familyHubRecipeDialogs.size),0);
});
