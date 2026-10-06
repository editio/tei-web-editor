// "Format and indent" (like oXygen's Ctrl/Cmd+Shift+P).
// Indents element-only content; mixed content (text + tags, e.g. a <p> with a
// <persName> inside) is kept exactly as written so no spaces are added to text.
import { SaxesParser } from "saxes";

const INDENT = "   ";
// Elements that are conventionally written as <x/> when they are empty.
const SELF_CLOSING = new Set([
  "lb", "pb", "cb", "gb", "milestone", "anchor", "gap", "space", "ptr", "graphic",
  "media", "caesura", "handShift", "addSpan", "delSpan", "damageSpan", "catRef",
  "classCode", "citeData", "binaryObject", "move", "link", "relation", "spanGrp",
  "metamark", "pause", "shift", "vocal", "kinesic", "incident", "iType", "fw",
]);

function parse(text) {
  const parser = new SaxesParser({ xmlns: false });
  const root = { type: "root", children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let failed = null;
  parser.on("error", (e) => {
    failed = failed || e;
  });
  parser.on("xmldecl", () => {});
  parser.on("doctype", (d) => top().children.push({ type: "doctype", text: d }));
  parser.on("processinginstruction", (pi) => top().children.push({ type: "pi", target: pi.target, body: pi.body }));
  parser.on("comment", (c) => top().children.push({ type: "comment", text: c }));
  parser.on("opentag", (n) => {
    const el = { type: "element", name: n.name, attrs: Object.entries(n.attributes), children: [] };
    top().children.push(el);
    stack.push(el);
  });
  parser.on("closetag", () => stack.pop());
  parser.on("text", (t) => top().children.push({ type: "text", text: t }));
  parser.on("cdata", (t) => top().children.push({ type: "cdata", text: t }));
  parser.write(text).close();
  if (failed) throw failed;
  return root;
}

const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");

function startTag(el) {
  return "<" + el.name + el.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
}

// Serialize without adding or removing any whitespace.
function inline(node) {
  switch (node.type) {
    case "text": return escText(node.text);
    case "cdata": return `<![CDATA[${node.text}]]>`;
    case "comment": return `<!--${node.text}-->`;
    case "pi": return `<?${node.target}${node.body ? " " + node.body : ""}?>`;
    case "doctype": return `<!DOCTYPE${node.text}>`;
    case "element":
      if (!node.children.length) return SELF_CLOSING.has(node.name) ? startTag(node) + "/>" : `${startTag(node)}></${node.name}>`;
      return `${startTag(node)}>${node.children.map(inline).join("")}</${node.name}>`;
  }
  return "";
}

const isBlankText = (n) => n.type === "text" && /^\s*$/.test(n.text);
const hasMixedContent = (el) => el.children.some((c) => (c.type === "text" && !isBlankText(c)) || c.type === "cdata");
const preservesSpace = (el) => el.attrs.some(([k, v]) => k === "xml:space" && v === "preserve");

function block(node, depth) {
  const pad = INDENT.repeat(depth);
  if (node.type !== "element") return pad + inline(node).trim();
  if (!node.children.length || hasMixedContent(node) || preservesSpace(node)) {
    return pad + inline(node);
  }
  const kids = node.children.filter((c) => !isBlankText(c)).map((c) => block(c, depth + 1));
  if (!kids.length) return pad + inline({ ...node, children: [] });
  return `${pad}${startTag(node)}>\n${kids.join("\n")}\n${pad}</${node.name}>`;
}

/** Returns the formatted document, or throws if it is not well-formed. */
export function formatXml(text) {
  const root = parse(text);
  const decl = /^﻿?\s*(<\?xml\s[^?]*\?>)/.exec(text);
  const parts = [];
  if (decl) parts.push(decl[1]);
  for (const node of root.children) {
    if (isBlankText(node)) continue;
    parts.push(block(node, 0));
  }
  return parts.join("\n") + "\n";
}
