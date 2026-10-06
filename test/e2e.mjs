import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
const t0 = Date.now();
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
try { await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent.includes('Valid'), { timeout: 15000 }); } catch (e) { console.log('TIMEOUT', await page.$eval('#status-valid', e => e.textContent)); await page.screenshot({ path: out + '/fail.png' }); console.log(logs.join('\n')); process.exit(1); }
console.log('ready in', Date.now() - t0, 'ms;', await page.$eval('#status-wf', e => e.textContent), '|', await page.$eval('#status-valid', e => e.textContent));
await page.screenshot({ path: out + '/s1.png' });

// type an unknown element into the body
const cm = '.cm-content';
const setCursorAfter = async (needle) => page.evaluate((needle) => {
  const view = document.querySelector('.cm-editor').cmView?.view;
  return !!view;
}, needle);
// Use CM view through DOM: EditorView.findFromDOM isn't exposed; use keyboard instead.
await page.click(cm);
// go to line with '<lg type="quatrain">' using search: Ctrl+F is heavy; instead use Mod-End then type
await page.keyboard.down('Meta'); await page.keyboard.press('End'); await page.keyboard.up('Meta');
console.log('doc text tail:', (await page.$eval(cm, e => e.innerText)).slice(-60).replace(/\n/g,'⏎'));
await browser.close();
console.log(logs.join('\n'));
