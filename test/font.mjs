import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('TEI'), { timeout: 15000 });
// paste German text into the first <l>
await page.evaluate(async () => {
  const t = await (await fetch('exercises/ex1/Lope_Sonett_1773_de/1.1-Lope-1773-Transcript.txt')).text();
  const line = t.split('\n').find(l => l.includes('ͤ'));
  const v = window.teiEditor; const d = v.state.doc.toString(); const i = d.indexOf('<l></l>') + 3;
  v.dispatch({ changes: { from: i, insert: line.trim() } });
});
await page.click('[data-tab=resources]');
const btns = await page.$$('.resource-btn');
for (const b of btns) if ((await b.evaluate(e => e.textContent)).includes('German 1773') && (await b.evaluate(e => e.textContent)).includes('Transcript')) { await b.click(); break; }
await new Promise(r => setTimeout(r, 1200));
console.log('fonts loaded:', await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)));
await page.screenshot({ path: out + '/font-ui.png', clip: { x: 0, y: 380, width: 1440, height: 260 } });
await page.click('[data-tab=preview]');
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: out + '/font-preview.png', clip: { x: 800, y: 330, width: 640, height: 200 } });
await browser.close();
