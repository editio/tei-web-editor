import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
for (const width of [1440, 1280, 390]) {
  await page.setViewport({ width, height: 900 });
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
  await page.select('#doc-select', 'ex1/1.4-Lope-sonnet-1822-done.xml');
  await new Promise(r => setTimeout(r, 600));
  const r = await page.$eval('#filename', e => ({ value: e.value, fits: e.scrollWidth <= e.clientWidth, w: e.clientWidth }));
  console.log(width, r, 'page overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await page.screenshot({ path: process.argv[2] + `/fname-${width}.png`, clip: { x: 0, y: 0, width, height: width < 500 ? 240 : 80 } });
}
await browser.close();
