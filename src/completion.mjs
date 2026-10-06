// Schema-aware suggestions: which elements / attributes / values are allowed
// at a given position, computed by running the document prefix through salve.
import { feed, allowedNames, patternNames, displayName, XML_NS } from "./validator.mjs";

// Attributes whose values point at an @xml:id ("#paris").
const POINTER_ATTRS = new Set([
  "ref", "corresp", "target", "who", "wit", "resp", "source", "sameAs", "ana",
  "hand", "scribeRef", "scriptRef", "change", "copyOf", "next", "prev", "synch",
  "facs", "start", "end", "from", "to", "decls", "inst", "select", "active", "passive",
]);

const ATTR_RE = /([^\s=<>"'\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Describe the syntactic position of `offset`: in text, a tag name, an attribute, a value or a closing tag. */
export function syntacticContext(text, offset) {
  const before = text.slice(0, offset);
  const lt = before.lastIndexOf("<");
  const gt = before.lastIndexOf(">");
  if (lt <= gt) return { kind: "text", tagStart: -1 };

  const tagText = before.slice(lt);
  if (/^<[!?]/.test(tagText)) return { kind: "other" };

  let m = /^<\/([^\s>]*)$/.exec(tagText);
  if (m) return { kind: "close", tagStart: lt, from: lt + 2, typed: m[1] };

  m = /^<([^\s>\/]*)$/.exec(tagText);
  if (m) return { kind: "element", tagStart: lt, from: lt + 1, typed: m[1] };

  m = /^<([^\s>\/]+)/.exec(tagText);
  if (!m) return { kind: "other" };
  const tagName = m[1];
  const rest = tagText.slice(m[0].length);

  // Inside an attribute value?
  const valueMatch = /([^\s=<>"'\/]+)\s*=\s*(["'])([^"']*)$/.exec(rest);
  if (valueMatch) {
    const restBeforeValue = rest.slice(0, valueMatch.index);
    return {
      kind: "value", tagStart: lt, tagName, attrName: valueMatch[1], quote: valueMatch[2],
      typed: valueMatch[3], from: offset - valueMatch[3].length,
      attrs: existingAttrs(restBeforeValue),
    };
  }
  const wordMatch = /(?:^|\s)([^\s=<>"'\/]*)$/.exec(rest);
  if (wordMatch && /\s/.test(rest.charAt(rest.length - wordMatch[1].length - 1) || "")) {
    return {
      kind: "attribute", tagStart: lt, tagName, typed: wordMatch[1],
      from: offset - wordMatch[1].length, attrs: existingAttrs(rest),
    };
  }
  return { kind: "other" };
}

function existingAttrs(s) {
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) out.push({ name: m[1], value: m[3] !== undefined ? m[3] : m[4] });
  return out;
}

function resolveQName(resolver, qname, isAttr) {
  if (isAttr && !qname.includes(":")) return { ns: "", name: qname };
  if (qname.startsWith("xml:")) return { ns: XML_NS, name: qname.slice(4) };
  const r = resolver.resolveName(qname, isAttr);
  return r ? { ns: r.ns, name: r.name } : { ns: "", name: qname };
}

// Open a start tag on the walker: element name + the attributes already typed.
function enterTag(state, tagName, attrs) {
  const { walker, resolver } = state;
  resolver.enterContext();
  for (const a of attrs) {
    if (a.name === "xmlns") resolver.definePrefix("", a.value);
    else if (a.name.startsWith("xmlns:")) resolver.definePrefix(a.name.slice(6), a.value);
  }
  const el = resolveQName(resolver, tagName, false);
  walker.fireEvent("enterStartTag", [el.ns, el.name]);
  for (const a of attrs) {
    if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue;
    const an = resolveQName(resolver, a.name, true);
    walker.fireEvent("attributeName", [an.ns, an.name]);
    walker.fireEvent("attributeValue", [a.value]);
  }
  return el;
}

export function qnameFor(n, isAttr) {
  if (n.ns === XML_NS) return "xml:" + n.name;
  return n.name;
}

/** Element names allowed at `offset` (where a new start tag would begin). */
export function elementsAt(text, offset, grammar) {
  if (!grammar) return [];
  const state = feed(text.slice(0, offset), grammar);
  return allowedNames(state.walker, "enterStartTag").map((n) => qnameFor(n, false));
}

/** Can element `qname` (at `offset`) have no content at all? Used to insert <lb/>-style tags. */
export function isEmptyElement(text, offset, grammar, qname) {
  if (!grammar) return false;
  const state = feed(text.slice(0, offset), grammar);
  enterTag(state, qname, []);
  // Required attributes would still be pending; empty only if nothing but endTag is possible.
  const w = state.walker;
  w.fireEvent("leaveStartTag", []);
  const evs = [...w.possible()];
  return evs.length > 0 && evs.every((ev) => ev.name === "endTag");
}

/** Open elements at `offset` (innermost last), e.g. for a breadcrumb or "split element". */
export function openElementsAt(text, offset) {
  return feed(text.slice(0, offset), null).stack;
}

function collectIds(text) {
  const ids = new Set();
  const re = /\bxml:id\s*=\s*(["'])([^"']+)\1/g;
  let m;
  while ((m = re.exec(text))) ids.add(m[2]);
  return [...ids];
}

/**
 * Suggestions at `offset`. Returns null or
 * {kind, from, to, items:[{label, detail, kind}], context}.
 */
export function suggestionsAt(text, offset, grammar, { explicit = false } = {}) {
  const ctx = syntacticContext(text, offset);
  if (!grammar && ctx.kind !== "close") return null;

  if (ctx.kind === "close") {
    const stack = feed(text.slice(0, ctx.tagStart), null).stack;
    const open = stack[stack.length - 1];
    if (!open) return null;
    return { kind: "close", from: ctx.from, items: [{ label: open.name, kind: "close" }], context: ctx };
  }

  if (ctx.kind === "element" || (ctx.kind === "text" && explicit)) {
    const at = ctx.kind === "element" ? ctx.tagStart : offset;
    const names = elementsAt(text, at, grammar);
    return {
      kind: ctx.kind === "element" ? "element" : "element-in-text",
      from: ctx.kind === "element" ? ctx.from : offset,
      items: names.sort((a, b) => a.localeCompare(b)).map((n) => ({ label: n, kind: "element" })),
      context: ctx,
    };
  }

  if (ctx.kind === "attribute" || ctx.kind === "value") {
    const state = feed(text.slice(0, ctx.tagStart), grammar);
    const el = enterTag(state, ctx.tagName, ctx.attrs);
    const elementName = qnameFor(el, false);

    if (ctx.kind === "attribute") {
      const used = new Set(ctx.attrs.map((a) => a.name));
      const names = allowedNames(state.walker, "attributeName")
        .map((n) => qnameFor(n, true))
        .filter((n) => !used.has(n))
        .sort((a, b) => a.localeCompare(b));
      return { kind: "attribute", from: ctx.from, element: elementName, items: names.map((n) => ({ label: n, kind: "attribute" })), context: ctx };
    }

    const an = resolveQName(state.resolver, ctx.attrName, true);
    state.walker.fireEvent("attributeName", [an.ns, an.name]);
    const values = new Set();
    for (const ev of state.walker.possible()) {
      if (ev.name === "attributeValue" && typeof ev.value === "string" && ev.value !== "") values.add(ev.value);
    }
    const items = [...values].sort().map((v) => ({ label: v, kind: "value" }));
    if (POINTER_ATTRS.has(ctx.attrName)) {
      for (const id of collectIds(text)) items.push({ label: "#" + id, kind: "id", detail: "xml:id in this document" });
    }
    if (!items.length) return null;
    return { kind: "value", from: ctx.from, element: elementName, attribute: ctx.attrName, items, context: ctx };
  }
  return null;
}

export { displayName, patternNames };
