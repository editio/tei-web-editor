// XPath box (browser only). Like oXygen, the TEI namespace is the default, so
// students can type //l instead of //tei:l (both work).
import { SaxesParser } from "saxes";
import { XML_NS } from "./validator.mjs";

// Line/column of every start tag, in document order (matches DOM order).
function elementPositions(text) {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const out = [];
  let start = null;
  parser.on("error", () => {});
  parser.on("opentagstart", () => {
    // saxes has consumed "<name" plus one character here.
    start = { line: parser.line, col: parser.column };
  });
  parser.on("opentag", (n) => {
    out.push({ line: start.line, col: Math.max(0, start.col - n.name.length - 2) });
  });
  parser.write(text).close();
  return out;
}

const TEI_DEFAULT_NS = /\sxmlns\s*=\s*(["'])http:\/\/www\.tei-c\.org\/ns\/1\.0\1/g;

function preview(node) {
  const max = 160;
  let s;
  if (node.nodeType === 1) s = new XMLSerializer().serializeToString(node);
  else if (node.nodeType === 2) s = `${node.name}="${node.value}"`;
  else s = node.nodeValue || "";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + " …" : s;
}

/**
 * Evaluate `expr` against `text`.
 * Returns {ok:true, type:"nodes", items:[{preview, kind, line, col}]}
 *      or {ok:true, type:"number"|"string"|"boolean", value}
 *      or {ok:false, error}.
 */
export function runXPath(text, expr) {
  expr = expr.trim();
  if (!expr) return { ok: false, error: "Type an XPath expression, e.g. //l" };
  const doc = new DOMParser().parseFromString(text.replace(TEI_DEFAULT_NS, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    return { ok: false, error: "The document is not well-formed, fix the errors first." };
  }
  const expr2 = expr.replace(/\btei:/g, "");
  const resolver = (prefix) => (prefix === "xml" ? XML_NS : null);
  let res;
  try {
    res = doc.evaluate(expr2, doc, resolver, XPathResult.ANY_TYPE, null);
  } catch (e) {
    const hint = /\b(tokenize|distinct-values|matches|replace|lower-case|upper-case|string-join|ends-with|format-date)\s*\(/.test(expr)
      ? " (Note: the browser supports XPath 1.0; XPath 2.0 functions such as this one are not available.)"
      : "";
    return { ok: false, error: `Invalid XPath expression: ${e.message.replace(/^.*?: /, "")}${hint}` };
  }
  switch (res.resultType) {
    case XPathResult.NUMBER_TYPE: return { ok: true, type: "number", value: res.numberValue };
    case XPathResult.STRING_TYPE: return { ok: true, type: "string", value: res.stringValue };
    case XPathResult.BOOLEAN_TYPE: return { ok: true, type: "boolean", value: res.booleanValue };
  }
  const nodes = [];
  for (let n = res.iterateNext(); n; n = res.iterateNext()) nodes.push(n);

  const positions = elementPositions(text);
  const all = Array.from(doc.getElementsByTagName("*"));
  const index = new Map(all.map((el, i) => [el, i]));
  const items = nodes.map((n) => {
    const owner = n.nodeType === 1 ? n : n.nodeType === 2 ? n.ownerElement : n.parentNode;
    const pos = owner && index.has(owner) ? positions[index.get(owner)] : null;
    const kind = { 1: "element", 2: "attribute", 3: "text", 8: "comment" }[n.nodeType] || "node";
    return { preview: preview(n), kind, line: pos ? pos.line : null, col: pos ? pos.col : 0 };
  });
  return { ok: true, type: "nodes", items };
}
