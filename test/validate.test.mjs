import fs from 'fs';
import { loadGrammar, validate } from '../src/validator.mjs';
const g = loadGrammar(fs.readFileSync(new URL('../site/schema/tei_all.json', import.meta.url),'utf8'));
for (const f of process.argv.slice(2)) {
  const r = validate(fs.readFileSync(f,'utf8'), g);
  console.log('==', f.split('/').pop(), 'wf', r.wellFormed, 'valid', r.valid);
  for (const e of r.errors.slice(0,4)) console.log(`  ${e.line}:${e.col} [${e.kind}] ${e.message}${e.hint? '\n     allowed: '+e.hint.slice(0,100):''}`);
}
