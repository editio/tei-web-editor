import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = async (label) => console.log(label, await page.evaluate(() => ({
  file: document.querySelector('#filename').value,
  doc: document.querySelector('#doc-select').selectedOptions[0]?.textContent,
  hasSomeText: window.teiEditor.state.doc.toString().includes('Some text here.'),
  status: document.querySelector('#status-valid .label').textContent,
})));
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('TEI'));
await state('1. first visit:');
await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('Some text here.'); v.dispatch({ changes: { from: i, to: i + 15, insert: 'Doris' } }); });
await sleep(600);
await page.select('#exercise-select', 'ex3'); await sleep(800);
await state('2. switch to ex3:');
await page.select('#exercise-select', 'ex1'); await sleep(800);
await state('3. back to ex1:');
console.log('   kept edit:', await page.evaluate(() => window.teiEditor.state.doc.toString().includes('<p>Doris</p>')));
await page.reload({ waitUntil: 'networkidle0' }); await sleep(800);
await state('4. after reload:');
console.log('errors', errs);
await browser.close();
