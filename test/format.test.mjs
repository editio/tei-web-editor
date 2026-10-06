import fs from 'fs';
import { formatXml } from '../src/format.mjs';
const ugly = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="x.rng" type="application/xml"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>T &amp; U</title></titleStmt><publicationStmt><p/></publicationStmt><sourceDesc><p>src</p></sourceDesc></fileDesc></teiHeader>
<text><body><!-- c --><p>À <placeName ref="#paris">Paris</placeName>, la <hi rend="b">x</hi> y<lb/></p><lg type="sonnet"><lg><l n="1">a</l>
<l n="2">b</l></lg></lg></body></text></TEI>`;
console.log(formatXml(ugly));
const done = fs.readFileSync('../TEI_BASIC/1.5.-FirstOption-TheaterPlay.xml','utf8');
const f = formatXml(done); console.log('idempotent:', formatXml(f) === f);
try { formatXml('<a><b></a>'); } catch(e) { console.log('throws on malformed:', e.message); }
