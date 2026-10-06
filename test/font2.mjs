import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('TEI'));
await page.click('[data-tab=resources]');
for (const b of await page.$$('.resource-btn')) { const t = await b.evaluate(e => e.textContent); if (t.includes('Transcript, German 1773')) { await b.click(); break; } }
await new Promise(r => setTimeout(r, 1000));
const pre = await page.$('pre.transcript');
await pre.evaluate(e => { const i = e.textContent.indexOf('ͤ'); e.scrollIntoView(); });
// Find the bounding box of the first line containing U+0364
const box = await page.evaluate(() => {
  const pre = document.querySelector('pre.transcript'); const tn = pre.firstChild; const i = tn.textContent.indexOf('ͤ');
  const r = document.createRange(); r.setStart(tn, Math.max(0, i - 40)); r.setEnd(tn, i + 120); r.startContainer.parentElement.scrollIntoView({block:'center'});
  const b = r.getBoundingClientRect(); return { x: b.x - 10, y: b.y - 10, width: 560, height: b.height + 20 };
});
await page.screenshot({ path: out + '/font-ue.png', clip: box });
// editor: line with mark
const ebox = await page.evaluate(() => {
  const v = window.teiEditor; const d = v.state.doc.toString(); const i = d.indexOf('<l></l>') + 3;
  v.dispatch({ changes: { from: i, insert: 'Ich glaube faſt, ich uͤberwinde; Kuß dafuͤr' }, scrollIntoView: true });
  return null;
});
await new Promise(r => setTimeout(r, 500));
const lineBox = await page.evaluate(() => { const el = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.includes('ͤ')); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y - 4, width: 700, height: b.height + 8 }; });
await page.screenshot({ path: out + '/font-editor.png', clip: lineBox });
await browser.close();
