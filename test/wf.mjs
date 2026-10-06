import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('TEI'));
await page.select('#doc-select', 'ex1/1.4-Lope-sonnet-1822-done.xml');
await new Promise(r => setTimeout(r, 800));
await page.click('[data-tab=problems]');
await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('</lg>') + 4; v.dispatch({ changes: { from: i, to: i + 1 }, selection: { anchor: i }, scrollIntoView: true }); v.focus(); });
await new Promise(r => setTimeout(r, 900));
console.log(await page.$eval('#status-wf', e => e.textContent), '|', await page.$$eval('.problem', ps => ps.map(p => p.innerText.replace(/\n+/g, ' ¦ '))));
await page.screenshot({ path: out + '/wf.png', clip: { x: 0, y: 100, width: 1440, height: 420 } });

await browser.close();
