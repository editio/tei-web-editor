// XML checking for the editor: well-formedness (saxes) and Relax NG validity (salve).
import { SaxesParser } from "saxes";
import { readTreeFromJSON, DefaultNameResolver } from "salve-annos";

export const TEI_NS = "http://www.tei-c.org/ns/1.0";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export function loadGrammar(json) {
  return readTreeFromJSON(json);
}

// Render a salve name the way a TEI user writes it: "l", "@n", "@xml:id".
export function displayName(ns, local, isAttr) {
  const prefix = isAttr ? "@" : "";
  if (ns === TEI_NS || ns === "") return prefix + local;
  if (ns === XML_NS) return prefix + "xml:" + local;
  return `${prefix}{${ns}}${local}`;
}

// Expand a salve name pattern into simple {ns, name} pairs (null for wildcards).
export function patternNames(pat) {
  if (!pat) return [];
  if (typeof pat.toArray === "function") {
    const arr = pat.toArray();
    if (arr) return arr.filter((n) => typeof n.name === "string");
  }
  return typeof pat.name === "string" ? [pat] : [];
}

function errorToString(err) {
  const isAttr = /attribute/i.test(err.msg || "");
  let names;
  try {
    names = err.getNames().map((n) => (typeof n.name === "string" ? displayName(n.ns, n.name, isAttr) : String(n)));
  } catch (e) {
    return err.toString();
  }
  const n = names[0];
  switch (err.msg) {
    case "tag not allowed here": return `Element <${n}> is not allowed here.`;
    case "tag not allowed here with these attributes": return `Element <${n}> is not allowed here with these attributes.`;
    case "tag required": return `Element <${n}> is missing: it is required here.`;
    case "unexpected end tag": return `Unexpected end tag </${n}>.`;
    case "attribute not allowed here": return `Attribute ${n} is not allowed on this element.`;
    case "attribute missing": return `Required attribute ${n} is missing.`;
    case "invalid attribute value": return `Invalid value for attribute ${n}.`;
    case "attribute value missing":
    case "attribute value required": return `Attribute ${n} needs a value.`;
    case "text not allowed here": return "Text is not allowed here: this element can only contain other elements.";
    case "value required": return "A value is required here.";
  }
  if (err.namesA) {
    const a = names.slice(0, err.namesA.length).join(", ");
    const b = names.slice(err.namesA.length).join(", ");
    return `Choose either ${a} or ${b}.`;
  }
  return err.toStringWithNames(names);
}

/** Names the schema accepts at the walker's position for an event kind. */
export function allowedNames(walker, kind) {
  const out = new Map();
  for (const ev of walker.possible()) {
    if (ev.name !== kind) continue;
    for (const n of patternNames(ev.namePattern)) {
      // Skip foreign namespaces (e.g. TEI examples' egXML): typing them unprefixed would be wrong.
      if (n.ns !== TEI_NS && n.ns !== "" && n.ns !== XML_NS) continue;
      out.set(`{${n.ns}}${n.name}`, n);
    }
  }
  return [...out.values()];
}

function hintFor(walker, kind) {
  if (kind === "attributeValue") {
    const values = new Set();
    for (const ev of walker.possible()) if (ev.name === "attributeValue" && typeof ev.value === "string" && ev.value) values.add(ev.value);
    return [...values].sort().join(", ");
  }
  const isAttr = kind === "attributeName";
  const list = allowedNames(walker, kind)
    .map((n) => displayName(n.ns, n.name, isAttr))
    .sort((a, b) => a.localeCompare(b));
  if (!list.length) return "";
  const shown = list.slice(0, 20).join(", ");
  return list.length > 20 ? `${shown}, … (${list.length} in total)` : shown;
}

// Locate the closing tag an error column points at, e.g. "</lgg>" -> {name, idx}.
function closeTagNear(lineText, col) {
  const idx = lineText.lastIndexOf("</", Math.max(0, col - 1));
  if (idx < 0) return null;
  const m = /^<\/\s*([^\s>]+)/.exec(lineText.slice(idx));
  return m ? { name: m[1], idx } : null;
}

// Elements still open at `offset`, computed on a clean prefix so that saxes'
// own error recovery (which pops elements) does not interfere.
function openStackAt(text, offset) {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack = [];
  parser.on("error", () => {});
  parser.on("opentagstart", (n) => stack.push({ name: n.name, line: parser.line }));
  parser.on("closetag", () => stack.pop());
  parser.write(text.slice(0, offset));
  return stack;
}

function friendlySyntaxMessage(raw, ctx) {
  const msg = raw.replace(/\.$/, "");
  if (msg === "unexpected close tag") {
    const close = closeTagNear(ctx.lineText, ctx.col);
    const name = close && close.name;
    const stack = close ? openStackAt(ctx.text, ctx.lineOffset + close.idx) : ctx.stack;
    const open = stack[stack.length - 1];
    if (name && open)
      return `Closing tag </${name}> does not match the open element <${open.name}> (opened on line ${open.line}).`;
    if (name) return `Closing tag </${name}> has no matching opening tag.`;
    return "Closing tag does not match the open element.";
  }
  if (msg.startsWith("unclosed tag: ")) {
    const name = msg.slice("unclosed tag: ".length);
    const open = ctx.stack.find((e) => e.name === name);
    return `Element <${name}> is never closed${open ? ` (opened on line ${open.line})` : ""}: add </${name}>.`;
  }
  if (msg === "text data outside of root node") return "Text outside the root element <TEI>: everything must be inside <TEI> … </TEI>.";
  if (msg === "document must contain a root element") return "The document is empty: it needs a root element such as <TEI>.";
  if (/^unbound namespace prefix/.test(msg)) return msg + " (declare the prefix or remove it).";
  return msg.charAt(0).toUpperCase() + msg.slice(1) + ".";
}

function lineColAt(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - (before.lastIndexOf("\n") + 1) };
}

// A "<" inside a tag means the previous tag was never finished (missing ">"
// or quote). Report that tag instead of the burst of errors saxes produces.
function unfinishedTag(text, badOffset) {
  if (text.charAt(badOffset) !== "<") return null;
  const tagStart = text.lastIndexOf("<", badOffset - 1);
  if (tagStart < 0) return null;
  const tagText = text.slice(tagStart, badOffset);
  const name = (/^<\/?([^\s>\/]*)/.exec(tagText) || [])[1] || "";
  const { line, col } = lineColAt(text, tagStart);
  // col + 1 so the editor highlights from the "<" of that tag.
  const at = { line, col: col + 1, kind: "syntax", tag: true };
  if (tagText.startsWith("</")) return { ...at, message: `Closing tag </${name} is missing its ">".` };
  const dq = (tagText.match(/"/g) || []).length;
  const sq = (tagText.match(/'/g) || []).length;
  if (dq % 2 || sq % 2) return { ...at, message: `A quote is missing in the start tag <${name}>: an attribute value is not closed.` };
  return { ...at, message: `Start tag <${name} is missing its ">".` };
}

// Only the first syntax error is reported: after one mistake saxes produces
// follow-up errors (often one per character) that would only confuse.
function wellFormedness(text) {
  let first = null;
  const parser = new SaxesParser({ xmlns: true, position: true });
  const lines = text.split("\n");
  const stack = [];
  parser.on("opentagstart", (n) => {
    stack.push({ name: n.name, line: parser.line });
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", (e) => {
    if (first) return;
    const m = /^(\d+):(\d+): (.*)$/s.exec(e.message);
    const line = m ? +m[1] : parser.line;
    const col = m ? +m[2] : parser.column;
    const raw = m ? m[3] : e.message;
    const lineText = lines[line - 1] || "";
    let lineOffset = 0;
    for (let i = 0; i < line - 1; i++) lineOffset += lines[i].length + 1;
    // saxes reports the column after the offending character.
    first = unfinishedTag(text, lineOffset + col - 1) ||
      { line, col, message: friendlySyntaxMessage(raw, { text, lineText, lineOffset, col, stack }), kind: "syntax" };
  });
  try {
    parser.write(text).close();
  } catch (e) {
    first = first || { line: parser.line, col: parser.column, message: e.message, kind: "syntax" };
  }
  return first ? [first] : [];
}

/**
 * Feed `text` to a fresh walker as a (possibly incomplete) document prefix.
 * Returns the walker positioned at the end of the prefix plus the stack of
 * still-open elements. Errors are collected but parsing never stops.
 */
export function feed(text, grammar, { collect = false, onEvent } = {}) {
  const resolver = new DefaultNameResolver();
  const walker = grammar ? grammar.newWalker(resolver) : null;
  const parser = new SaxesParser({ xmlns: true, position: true });
  const errors = [];
  const stack = [];
  let pos = { line: 1, col: 0 };
  let textBuf = "";
  let textPos = null;

  const fire = (name, args, at) => {
    if (!walker) return;
    const before = collect && (name === "enterStartTag" || name === "attributeName" || name === "attributeValue") ? walker.clone() : null;
    const ret = walker.fireEvent(name, args);
    if (collect && ret instanceof Array) {
      for (const err of ret) {
        errors.push({ line: at.line, col: at.col, message: errorToString(err), kind: "schema", hint: before ? hintFor(before, name) : "" });
      }
    }
  };
  const here = () => ({ line: parser.line, col: parser.column });
  const flush = () => {
    if (textBuf !== "") fire("text", [textBuf], textPos || pos);
    textBuf = "";
    textPos = null;
  };

  parser.on("error", () => {});
  parser.on("opentagstart", () => {
    pos = here();
  });
  parser.on("opentag", (node) => {
    const at = { ...pos };
    flush();
    const nsDecls = [];
    const attrs = [];
    for (const key of Object.keys(node.attributes)) {
      const a = node.attributes[key];
      if (key === "xmlns") nsDecls.push(["", a.value]);
      else if (a.prefix === "xmlns") nsDecls.push([a.local, a.value]);
      else attrs.push(a);
    }
    resolver.enterContext();
    for (const [p, uri] of nsDecls) resolver.definePrefix(p, uri);
    fire("enterStartTag", [node.uri, node.local], at);
    for (const a of attrs) {
      fire("attributeName", [a.uri, a.local], at);
      fire("attributeValue", [a.value], at);
    }
    fire("leaveStartTag", [], at);
    stack.push({ name: node.name, uri: node.uri, local: node.local, attributes: node.attributes, line: at.line, col: at.col });
    if (onEvent) onEvent("open", node, at);
  });
  const onText = (t) => {
    if (textPos === null) textPos = { ...pos };
    textBuf += t;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", (node) => {
    const at = here();
    flush();
    stack.pop();
    fire("endTag", [node.uri, node.local], at);
    resolver.leaveContext();
    pos = at;
  });
  parser.write(text);
  return { walker, resolver, stack, errors, parser, finish: () => { parser.close(); flush(); return pos; } };
}

/**
 * Validate a whole document.
 * Returns {wellFormed, valid, errors:[{line, col, message, kind, hint}]};
 * `valid` is null when no grammar is loaded yet.
 */
export function validate(text, grammar) {
  const wfErrors = wellFormedness(text);
  if (wfErrors.length) return { wellFormed: false, valid: false, errors: wfErrors.slice(0, 10) };
  if (!grammar) return { wellFormed: true, valid: null, errors: [] };

  const run = feed(text, grammar, { collect: true });
  const endPos = run.finish();
  const errors = run.errors;
  const endRet = run.walker.end();
  if (endRet instanceof Array) {
    for (const err of endRet) errors.push({ line: endPos.line, col: endPos.col, message: errorToString(err), kind: "schema", hint: "" });
  }
  return { wellFormed: true, valid: errors.length === 0, errors };
}
