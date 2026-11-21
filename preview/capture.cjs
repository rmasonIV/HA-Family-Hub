const assert = require('node:assert/strict');
const {mkdir} = require('node:fs/promises');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const output = join(__dirname, '../images/live');
const url = pathToFileURL(join(__dirname, 'live.html')).href + '?capture';
const desktop = {width:1440, height:950};

async function checkHeader(page, width) {
  const header = page.locator('.calendar-header');
  assert.equal(await header.locator('h2').count(), 0);
  const legend = await header.locator('.calendar-legend').boundingBox();
  const toggle = await header.locator('.view-toggle').boundingBox();
  const bounds = await header.boundingBox();
  assert.ok(legend.x >= bounds.x && legend.x + legend.width <= bounds.x + bounds.width + 1);
  assert.ok(toggle.x >= bounds.x && toggle.x + toggle.width <= bounds.x + bounds.width + 1);
  if (width === desktop.width) {
    assert.ok(legend.x + legend.width <= toggle.x && Math.abs(legend.y - toggle.y) < 12);
  } else {
    assert.ok(toggle.y >= legend.y + legend.height);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

async function main() {
  await mkdir(output, {recursive:true});
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport:desktop, deviceScaleFactor:1, locale:'en-US', timezoneId:'America/Chicago',
      reducedMotion:'reduce'
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(url);
    await page.locator('#month-grid .event').first().waitFor();
    await page.locator('#widget-panel strong').last().waitFor();
    await checkHeader(page, desktop.width);

    const capture = name => page.locator('body').screenshot({
      path:join(output, name+'.png'), animations:'disabled'
    });
    await capture('month');
    await page.locator('#week-view').click();
    await page.locator('#week-days .forecast-icon').first().waitFor();
    await capture('week');

    const dinner = page.getByRole('button', {name:'Mealie Dinner', exact:true});
    await dinner.click();
    assert.equal(await dinner.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#week-days .event').allTextContents(), ['Lemon chickpea bowls']);
    await page.locator('#month-view').click();
    assert.deepEqual(await page.locator('#month-grid .event').allTextContents(), ['Lemon chickpea bowls']);
    await capture('filtered');
    await dinner.click();

    await page.locator('#quick-toggle').click();
    await page.locator('#quick-controls .quick-control').last().waitFor();
    await page.locator('#week-view').click();
    await capture('quick-actions');
    await page.locator('#quick-toggle').click();

    await page.locator('#month-view').click();
    await page.locator('.month-day[data-day="10"]').click();
    await page.locator('#day-weather .forecast-icon').waitFor();
    await capture('widgets-weather');

    for (const width of [390, 320]) {
      await page.setViewportSize({width, height:850});
      await checkHeader(page, width);
      await page.locator('#week-view').click();
      await checkHeader(page, width);
      await page.locator('#month-view').click();
    }
    assert.deepEqual(errors, []);
    console.log('Captured five screenshots and checked Month and Week at desktop and phone widths.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
