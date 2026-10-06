import fs from 'fs';
import { loadGrammar } from '../src/validator.mjs';
import { suggestionsAt, isEmptyElement, openElementsAt } from '../src/completion.mjs';
const g = loadGrammar(fs.readFileSync(new URL('../site/schema/tei_all.json', import.meta.url),'utf8'));
const base = fs.readFileSync('../TEI_Entities/3.4-Stendhal_Memoires_1838_empty.xml','utf8');
function at(marker, text) { const i = text.indexOf('|'); return [text.slice(0,i)+text.slice(i+1), i]; }
const cases = {
  afterFileDesc: base.replace('</fileDesc>', '</fileDesc>\n<|'),
  inBodyP: base.replace(/<p>/, '<p>Hello <pers|'),
  attrPlace: base.replace('</fileDesc>', '</fileDesc><profileDesc><settingDesc><listPlace><place |'),
  valueRef: base.replace('</fileDesc>', '</fileDesc><profileDesc><settingDesc><listPlace><place xml:id="paris"/></listPlace></settingDesc></profileDesc>').replace(/<p>/, '<p><placeName ref="|'),
  valueIdnoType: base.replace(/<p>/, '<p><idno type="|'),
  valueCert: base.replace(/<p>/, '<p><placeName cert="|'),
  close: base.replace(/<p>/, '<p><persName>Tocq</|'),
};
for (const [k, t] of Object.entries(cases)) {
  const [text, off] = at('|', t);
  const t0 = Date.now();
  const r = suggestionsAt(text, off, g);
  console.log(k, (Date.now()-t0)+'ms', r && r.kind, r && r.items.length, r && r.items.slice(0,12).map(i=>i.label).join(' '));
}
const [t2, o2] = at('|', base.replace(/<p>/, '<p>|'));
console.log('lb empty?', isEmptyElement(t2, o2, g, 'lb'), 'persName empty?', isEmptyElement(t2, o2, g, 'persName'));
console.log('stack', openElementsAt(t2, o2).map(e=>e.name).join(' > '));
