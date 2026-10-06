import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('TEI'));
await page.evaluate(() => { const v = window.teiEditor; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'Verſprichſt du einen Kuß dafuͤr.\nDas ſich Myrtill nicht unterſtuͤnde?\nIch glaube faſt, ich uͤberwinde;' } }); });
await page.click('[data-tab=resources]');
for (const b of await page.$$('.resource-btn')) { const t = await b.evaluate(e => e.textContent); if (t.includes('Transcript, German 1773')) { await b.click(); break; } }
await new Promise(r => setTimeout(r, 1000));
await page.evaluate(() => { document.querySelector('#panel-resources').scrollTop = 99999; });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: out + '/font-all.png' });
await browser.close();
