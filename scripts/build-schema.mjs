// Converts tei_all.rng into the files the editor loads at runtime:
//   site/schema/tei_all.json  - pre-simplified grammar for the salve validator
//   site/schema/tei_docs.json - short element/attribute glosses for autocompletion
//
// Usage: node scripts/build-schema.mjs [path-or-url-to-rng]
// Default source: the current TEI release of tei_all.rng.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { SaxesParser } from "saxes";

const require = createRequire(import.meta.url);
const salve = require("salve-annos/lib/salve/validate.js");

const DEFAULT_URL = "https://www.tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "site", "schema");
const cacheFile = path.join(root, "scripts", "tei_all.rng");

async function loadSource(arg) {
  if (arg && !/^https?:/.test(arg)) return fs.readFileSync(arg, "utf8");
  const url = arg || DEFAULT_URL;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Minimal element tree from saxes, enough for walking the RNG.
function parseTree(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const top = { children: [] };
  const stack = [top];
  parser.on("opentag", (n) => {
    const el = { uri: n.uri, local: n.local, attrs: {}, children: [], text: "" };
    for (const [k, a] of Object.entries(n.attributes)) el.attrs[a.local || k] = a.value;
    stack[stack.length - 1].children.push(el);
    stack.push(el);
  });
  parser.on("text", (t) => {
    stack[stack.length - 1].text += t;
  });
  parser.on("closetag", () => stack.pop());
  parser.write(xml).close();
  return top.children[0];
}

const RNG = "http://relaxng.org/ns/structure/1.0";
const ANN = "http://relaxng.org/ns/compatibility/annotations/1.0";
const isRng = (e, name) => e.uri === RNG && e.local === name;
const docOf = (e) => {
  const d = e.children.find((c) => c.uri === ANN && c.local === "documentation");
  return d ? d.text.replace(/\s+/g, " ").trim() : "";
};

function extractDocs(tree) {
  const defines = new Map();
  for (const c of tree.children) if (isRng(c, "define")) defines.set(c.attrs.name, c);
  const elementOfDefine = (d) => d.children.find((c) => isRng(c, "element"));

  const elements = {};
  const attributes = {};
  const docTable = [];
  const docIndex = new Map();
  const intern = (s) => {
    if (!docIndex.has(s)) {
      docIndex.set(s, docTable.length);
      docTable.push(s);
    }
    return docIndex.get(s);
  };

  for (const d of defines.values()) {
    const el = elementOfDefine(d);
    if (!el || !el.attrs.name) continue;
    const name = el.attrs.name;
    if (elements[name] !== undefined) continue;
    elements[name] = docOf(el);
    const attrs = {};
    const seen = new Set();
    const walk = (node) => {
      for (const c of node.children) {
        if (isRng(c, "element")) continue; // child elements have their own entries
        if (isRng(c, "attribute")) {
          const an = c.attrs.name;
          if (an && attrs[an] === undefined) {
            const doc = docOf(c);
            if (doc) attrs[an] = intern(doc);
          }
          continue;
        }
        if (isRng(c, "ref")) {
          const target = defines.get(c.attrs.name);
          if (target && !elementOfDefine(target) && !seen.has(c.attrs.name)) {
            seen.add(c.attrs.name);
            walk(target);
          }
          continue;
        }
        walk(c);
      }
    };
    walk(el);
    attributes[name] = attrs;
  }
  return { elements, attributes, docs: docTable };
}

const source = await loadSource(process.argv[2]);
fs.writeFileSync(cacheFile, source);
const version = (/Edition: ([^\n]*?)\s*Last updated on ([^,\n]*)/.exec(source) || []).slice(1).join(", ");
console.log(`TEI schema: ${version || "unknown version"}`);

fs.mkdirSync(outDir, { recursive: true });
const result = await salve.convertRNGToPattern(new URL("file://" + cacheFile));
if (result.warnings.length) console.warn(result.warnings);
const json = salve.writeTreeToJSON(result.simplified, 3);
fs.writeFileSync(path.join(outDir, "tei_all.json"), json);
console.log(`tei_all.json: ${(json.length / 1e6).toFixed(1)} MB`);

const docs = extractDocs(parseTree(source));
docs.version = version;
const docsJson = JSON.stringify(docs);
fs.writeFileSync(path.join(outDir, "tei_docs.json"), docsJson);
console.log(`tei_docs.json: ${Object.keys(docs.elements).length} elements, ${(docsJson.length / 1e3).toFixed(0)} KB`);
