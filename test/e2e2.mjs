import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#status-valid .label').textContent === 'Valid TEI', { timeout: 15000 });
await page.select('#doc-select', 'ex1/1.3-Lope-sonnet-empty.xml');
await new Promise(r => setTimeout(r, 800));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const status = async () => (await page.$eval('#status-wf .label', e => e.textContent)) + ' | ' + (await page.$eval('#status-valid .label', e => e.textContent));
const cursorAfter = (needle, extra = 0) => page.evaluate((needle, extra) => {
  const v = window.teiEditor; const i = v.state.doc.toString().indexOf(needle);
  v.dispatch({ selection: { anchor: i + needle.length + extra } }); v.focus(); return i;
}, needle, extra);
const options = () => page.$$eval('.cm-tooltip-autocomplete li', ls => ls.map(l => l.textContent));

// 1. Completion after "<" inside first quatrain
await cursorAfter('<lg>\n            <lg>');
await page.keyboard.press('Enter');
await page.keyboard.type('<');
await sleep(400);
let opts = await options();
console.log('1. "<" in lg →', opts.length, 'options; first:', opts.slice(0, 8).join(', '));
await page.keyboard.type('l');
await sleep(300);
opts = await options();
console.log('   after "<l" →', opts.slice(0, 6).join(', '));
await page.screenshot({ path: out + '/e1-completion.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// accept completion of "l"
await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control'); await sleep(300);
await page.keyboard.press('Enter'); await sleep(200);
console.log('   inserted line:', JSON.stringify(await page.evaluate(() => { const v = window.teiEditor; return v.state.doc.lineAt(v.state.selection.main.head).text; })));

// 2. Attribute completion: type space inside start tag
await page.evaluate(() => { const v = window.teiEditor; const h = v.state.selection.main.head; v.dispatch({ selection: { anchor: h - 1 } }); });
await page.keyboard.type(' ');
await sleep(400);
opts = await options();
console.log('2. attributes of <l> →', opts.length, ':', opts.slice(0, 10).join(', '));
await page.screenshot({ path: out + '/e2-attrs.png' });
await page.keyboard.press('Escape');
await sleep(500);
console.log('   status with empty <l >:', await status());

// 3. Invalid element
await cursorAfter('<l></l>\n               <l></l>\n               <l></l>\n            </lg>\n\n            <lg>\n               <l></l>\n               <l></l>\n               <l></l>\n            </lg>\n\n            <lg>');
await page.keyboard.type('<stanza>');
await sleep(800);
console.log('3. after <stanza>:', await status());
const probs = await page.$$eval('.problem', ps => ps.map(p => p.innerText.replace(/\n+/g, ' ¦ ')));
console.log('   problems:', probs.slice(0, 3));
await page.screenshot({ path: out + '/e3-invalid.png' });

// 4. Break well-formedness: remove </stanza> that autoclose inserted? check text
const snippet = await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('<stanza'); return t.slice(i, i + 30); });
console.log('4. autoclosed?', JSON.stringify(snippet));
await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('</stanza>'); if (i >= 0) v.dispatch({ changes: { from: i, to: i + 9 } }); });
await sleep(800);
console.log('   after deleting </stanza>:', await status());
console.log('   problems:', (await page.$$eval('.problem', ps => ps.map(p => p.innerText.replace(/\n+/g, ' ¦ ')))).slice(0, 2));
await page.screenshot({ path: out + '/e4-wf.png' });
// restore via Reset (confirm dialog)
page.on('dialog', d => d.accept());
await page.click('#btn-reset');
await sleep(800);
console.log('   after reset:', await status());

// 5. Load solution and run XPath
await page.select('#doc-select', 'ex1/1.4-Lope-sonnet-1822-done.xml');
await sleep(800);
await page.click('[data-tab=xpath]');
await page.click('#xpath-input', { clickCount: 3 });
await page.keyboard.type('//l[@n="2"]');
await page.keyboard.press('Enter');
await sleep(300);
console.log('5. xpath //l[@n="2"]:', await page.$eval('#xpath-results', e => e.innerText.replace(/\n+/g, ' ¦ ')));
await page.click('.xpath-example');  // //l
await sleep(300);
console.log('   //l summary:', await page.$eval('.xpath-summary', e => e.textContent));
await page.click('.xpath-list li:nth-child(3) button');
console.log('   jumped to line:', await page.evaluate(() => { const v = window.teiEditor; return v.state.doc.lineAt(v.state.selection.main.head).text.trim(); }));
await page.$eval('#xpath-input', e => e.value = '');
await page.click('#xpath-input');
await page.keyboard.type('count(//l)');
await page.keyboard.press('Enter'); await sleep(200);
console.log('   count:', await page.$eval('#xpath-results', e => e.innerText));
await page.screenshot({ path: out + '/e5-xpath.png' });

// 6. Preview
await page.click('[data-tab=preview]');
await sleep(1200);
const frameInfo = await page.evaluate(() => { const d = document.querySelector('#preview-frame').contentDocument; if (!d || !d.documentElement) return 'no doc'; const l = d.getElementsByTagName('l')[0]; return d.documentElement.nodeName + ' l display=' + (l ? getComputedStyle(l).display : 'none') + ' sheets=' + d.styleSheets.length; });
console.log('6. preview:', frameInfo);
await page.screenshot({ path: out + '/e6-preview.png' });

// 7. Wrap selection
await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('Doris'); v.dispatch({ selection: { anchor: i, head: i + 5 } }); v.focus(); });
await page.keyboard.down('Meta'); await page.keyboard.press('e'); await page.keyboard.up('Meta');
await sleep(300);
console.log('7. dialog open:', await page.$eval('#name-dialog', d => d.open), 'help:', await page.$eval('#name-help', e => e.textContent));
await page.keyboard.type('persName');
await page.keyboard.press('Enter');
await sleep(600);
console.log('   line now:', await page.evaluate(() => { const v = window.teiEditor; return v.state.doc.lineAt(v.state.selection.main.head).text.trim(); }), '|', await status());

// 8. Value completion for @ref with ids
await page.evaluate(() => { const v = window.teiEditor; const t = v.state.doc.toString(); const i = t.indexOf('<persName>') + '<persName'.length;
  v.dispatch({ changes: [{ from: t.indexOf('<lg type="sonnet">') + 3, insert: ' xml:id="doris"' }] });
  const t2 = v.state.doc.toString(); const j = t2.indexOf('<persName>') + '<persName'.length; v.dispatch({ selection: { anchor: j } }); v.focus(); });
await page.keyboard.type(' ref="');
await sleep(400);
console.log('8. ref value options:', (await options()).join(', '));
await page.keyboard.press('Enter');
await sleep(200);
await page.keyboard.type('"');
await sleep(600);
console.log('   line now:', await page.evaluate(() => { const v = window.teiEditor; return v.state.doc.lineAt(v.state.selection.main.head).text.trim(); }), '|', await status());

// 9. Format & materials
await page.click('#btn-format'); await sleep(300);
console.log('9. toast:', await page.$$eval('.toast', t => t.map(x => x.textContent)));
await page.click('[data-tab=resources]');
await page.click('.resource-btn:nth-of-type(1)');
const btns = await page.$$('.resource-btn');
await btns[1].click(); await sleep(400);
console.log('   transcript:', (await page.$eval('#resource-view', e => e.innerText)).slice(0, 80).replace(/\n/g, '⏎'));
await page.screenshot({ path: out + '/e9-materials.png' });
await browser.close();
console.log('LOGS:\n' + logs.join('\n'));
