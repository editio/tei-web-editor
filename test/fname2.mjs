import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.select('#doc-select', 'ex1/1.4-Lope-sonnet-1822-done.xml');
await new Promise(r => setTimeout(r, 600));
console.log(await page.$eval('#filename', e => ({ style: e.style.width, computed: getComputedStyle(e).width, max: getComputedStyle(e).maxWidth, parentW: e.parentElement.clientWidth })));
await browser.close();
