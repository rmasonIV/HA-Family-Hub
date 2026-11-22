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
        assert.ok(aerial.y >= 0 && aerial.y + aerial.height <= outer.y + 1);
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
