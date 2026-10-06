import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip } from "@codemirror/view";
import { EditorState, Compartment, EditorSelection, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { linter, lintGutter, forceLinting } from "@codemirror/lint";
import { autocompletion, startCompletion, completionKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, foldKeymap } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

import { loadGrammar, validate } from "./validator.mjs";
import { suggestionsAt, elementsAt, isEmptyElement, openElementsAt } from "./completion.mjs";
import { formatXml } from "./format.mjs";
import { runXPath } from "./xpath.mjs";

// ---------------------------------------------------------------- state

const STORE = "teiwe:";
const app = {
  grammar: null,
  docs: null,
  manifest: { exercises: [] },
  exercise: null, // current exercise object
  doc: null, // {key, filename, origin, exerciseId}
  lastResult: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
};

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(STORE + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(STORE + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(STORE + key);
    } catch (e) {}
  },
};

const TEI_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="http://www.tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
<?xml-model href="http://www.tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng" type="application/xml"
	schematypens="http://purl.oclc.org/dsdl/schematron"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
   <teiHeader>
      <fileDesc>
         <titleStmt>
            <title>Title</title>
         </titleStmt>
         <publicationStmt>
            <p>Publication Information</p>
         </publicationStmt>
         <sourceDesc>
            <p>Information about the source</p>
         </sourceDesc>
      </fileDesc>
   </teiHeader>
   <text>
      <body>
         <p>Some text here.</p>
      </body>
   </text>
</TEI>
`;

// ---------------------------------------------------------------- helpers

function toast(message, kind = "info") {
  const t = el("div", { class: `toast toast-${kind}`, role: "status" }, message);
  $("#toasts").append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function guidelinesUrl(name) {
  return `https://www.tei-c.org/release/doc/tei-p5-doc/en/html/ref-${encodeURIComponent(name)}.html`;
}

function elementDoc(name) {
  return app.docs && app.docs.elements[name] ? app.docs.elements[name] : "";
}

function attributeDoc(element, attr) {
  if (!app.docs) return "";
  const map = app.docs.attributes[element];
  if (map && map[attr] !== undefined) return app.docs.docs[map[attr]];
  return "";
}

function docNode(title, text, link) {
  const box = el("div", { class: "cm-doc" }, el("strong", {}, title));
  if (text) box.append(el("p", {}, text.replace(/\s*\[[^\]]*\]\s*$/, "")));
  if (link) box.append(el("a", { href: link, target: "_blank", rel: "noopener" }, "TEI Guidelines ↗"));
  return box;
}

// Convert an error's line/column into an editor range covering the tag or char.
function errorRange(doc, err) {
  const lineNo = Math.min(Math.max(1, err.line || 1), doc.lines);
  const line = doc.line(lineNo);
  const col = Math.min(err.col || 0, line.length);
  const text = line.text;
  let from = line.from + Math.max(0, col - 1);
  let to = line.from + col;
  const lt = text.lastIndexOf("<", Math.max(0, col - 1));
  if (lt >= 0 && (err.kind === "schema" || err.tag || /^Closing tag/.test(err.message))) {
    const m = /^<\/?[^\s>\/]*/.exec(text.slice(lt));
    from = line.from + lt;
    to = from + (m ? m[0].length : 1);
  }
  if (to <= from) to = Math.min(line.to, from + 1);
  if (to <= from && from > line.from) from = to - 1;
  return { from, to };
}

// ---------------------------------------------------------------- editor

const themeCompartment = new Compartment();
// Dispatched to make the linter re-run without a document change (e.g. schema loaded).
const relint = StateEffect.define();
function revalidate(view) {
  view.dispatch({ effects: relint.of(null) });
  forceLinting(view);
}
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const editorTheme = () => (darkQuery.matches ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true }));

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { maxHeight: "16em", fontFamily: "inherit" },
  ".cm-completionInfo": { maxWidth: "340px", padding: "8px 10px" },
  ".cm-diagnosticText": { whiteSpace: "pre-wrap" },
});

function lintSource(view) {
  const text = view.state.doc.toString();
  const result = validate(text, app.grammar);
  app.lastResult = result;
  renderStatus(result);
  renderProblems(result);
  return result.errors.map((e) => {
    const { from, to } = errorRange(view.state.doc, e);
    return {
      from,
      to,
      severity: "error",
      source: e.kind === "syntax" ? "XML" : "TEI",
      message: e.message + (e.hint ? `\nAllowed here: ${e.hint}` : ""),
    };
  });
}

function makeOption(item, r) {
  if (item.kind === "element") {
    const name = item.label;
    return {
      label: name,
      type: "type",
      info: () => docNode(`<${name}>`, elementDoc(name), guidelinesUrl(name)),
      apply: (view, completion, from, to) => {
        const text = view.state.doc.toString();
        const withBracket = r.kind === "element";
        const tagStart = withBracket ? from - 1 : from;
        const after = text.slice(to, to + 200);
        // Tag already continues (attributes or ">"): only replace the name.
        if (withBracket && /^[^\s<>\/]*(\s+[^\s=]+\s*=|\s*\/?>)/.test(after)) {
          const nameEnd = to + /^[^\s<>\/]*/.exec(after)[0].length;
          view.dispatch({ changes: { from, to: nameEnd, insert: name }, selection: { anchor: from + name.length } });
          return;
        }
        const open = withBracket ? "" : "<";
        const empty = isEmptyElement(text, tagStart, app.grammar, name);
        const insert = empty ? `${open}${name}/>` : `${open}${name}></${name}>`;
        const cursor = empty ? from + insert.length : from + open.length + name.length + 1;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor }, userEvent: "input.complete" });
      },
    };
  }
  if (item.kind === "attribute") {
    const name = item.label;
    return {
      label: name,
      type: "property",
      info: () => docNode(`@${name}`, attributeDoc(r.element, name), guidelinesUrl(r.element)),
      apply: (view, completion, from, to) => {
        const after = view.state.doc.sliceString(to, to + 3);
        if (/^\s*=/.test(after)) {
          view.dispatch({ changes: { from, to, insert: name } });
          return;
        }
        view.dispatch({ changes: { from, to, insert: `${name}=""` }, selection: { anchor: from + name.length + 2 }, userEvent: "input.complete" });
        setTimeout(() => startCompletion(view), 20);
      },
    };
  }
  if (item.kind === "close") {
    return {
      label: item.label,
      type: "keyword",
      detail: "close tag",
      apply: (view, completion, from, to) => {
        const hasGt = view.state.doc.sliceString(to, to + 1) === ">";
        const insert = item.label + (hasGt ? "" : ">");
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (hasGt ? 1 : 0) } });
      },
    };
  }
  return { label: item.label, type: item.kind === "id" ? "variable" : "enum", detail: item.detail };
}

function teiCompletions(context) {
  if (!app.grammar) return null;
  const text = context.state.doc.toString();
  const r = suggestionsAt(text, context.pos, app.grammar, { explicit: context.explicit });
  if (!r || !r.items.length) return null;
  return {
    from: r.from,
    options: r.items.map((item) => makeOption(item, r)),
    validFor: r.kind === "value" ? /^[^"'<>]*$/ : /^[\w:.\-]*$/,
  };
}

// Hover over a tag name to see what the element is for.
const tagHover = hoverTooltip((view, pos) => {
  if (!app.docs) return null;
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;
  const re = /<\/?([A-Za-z_][\w.\-]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length - m[1].length;
    const end = start + m[1].length;
    if (col >= start && col <= end) {
      const name = m[1];
      if (!app.docs.elements[name]) return null;
      return {
        pos: line.from + start,
        end: line.from + end,
        above: true,
        create: () => ({ dom: docNode(`<${name}>`, elementDoc(name), guidelinesUrl(name)) }),
      };
    }
  }
  return null;
});

// ---- editing commands (oXygen-like)

function wrapSelection(view) {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const names = app.grammar ? elementsAt(text, from, app.grammar) : [];
  askElementName(from === to ? "Insert element" : "Surround with element", names, (name) => {
    if (!name) return;
    const open = `<${name}>`;
    const close = `</${name}>`;
    view.dispatch({
      changes: [{ from, insert: open }, { from: to, insert: close }],
      selection: from === to ? { anchor: from + open.length } : { anchor: from + open.length, head: to + open.length },
      userEvent: "input",
    });
    view.focus();
  });
  return true;
}

function splitElement(view) {
  const pos = view.state.selection.main.head;
  const text = view.state.doc.toString();
  const stack = openElementsAt(text, pos);
  const top = stack[stack.length - 1];
  if (!top || stack.length < 2) {
    toast("Place the cursor inside the element you want to split, e.g. inside a <p>.");
    return true;
  }
  const attrs = Object.entries(top.attributes)
    .filter(([k]) => k !== "xml:id" && k !== "xmlns" && !k.startsWith("xmlns:"))
    .map(([k, a]) => ` ${k}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  const insert = `</${top.name}>\n<${top.name}${attrs}>`;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: "input" });
  return true;
}

function formatDocument(view) {
  try {
    const formatted = formatXml(view.state.doc.toString());
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
    const l = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
    toast("Document formatted and indented.");
  } catch (e) {
    toast("Cannot format: the document is not well-formed. Fix the errors first.", "error");
  }
  return true;
}

function jumpTo(line, col = 0) {
  const doc = editor.state.doc;
  const l = doc.line(Math.min(Math.max(1, line), doc.lines));
  const pos = l.from + Math.min(col, l.length);
  editor.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  editor.focus();
}

const updateBreadcrumb = debounce((state) => {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  $("#cursor-pos").textContent = `Line ${line.number}, Col ${pos - line.from + 1}`;
  const stack = openElementsAt(state.doc.sliceString(0, pos), pos);
  const crumbs = $("#breadcrumb");
  crumbs.replaceChildren(...stack.map((s, i) => el("span", { class: "crumb", title: elementDoc(s.local || s.name) }, (i ? "› " : "") + s.name)));
}, 120);

const autosave = debounce(() => saveCurrent(), 400);

function editorExtensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    lintGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    xml(),
    EditorView.lineWrapping,
    themeCompartment.of(editorTheme()),
    baseTheme,
    autocompletion({ override: [teiCompletions], icons: true, maxRenderedOptions: 400 }),
    linter(lintSource, { delay: 300, needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(relint))) }),
    tagHover,
    keymap.of([
      { key: "Mod-e", run: wrapSelection, preventDefault: true },
      { key: "Alt-Shift-d", run: splitElement, preventDefault: true },
      { key: "Mod-Shift-p", run: formatDocument, preventDefault: true },
      { key: "Mod-Shift-f", run: formatDocument, preventDefault: true },
      { key: "Mod-s", run: () => (downloadCurrent(), true), preventDefault: true },
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        autosave();
        schedulePreview();
      }
      if (u.docChanged || u.selectionSet) updateBreadcrumb(u.state);
    }),
  ];
}

const editor = new EditorView({
  parent: $("#editor"),
  state: EditorState.create({ doc: "", extensions: editorExtensions() }),
});

const cssEditor = new EditorView({
  parent: $("#css-editor"),
  state: EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(), history(), drawSelection(), bracketMatching(), css(), EditorView.lineWrapping,
      themeCompartment.of(editorTheme()), baseTheme,
      keymap.of([...historyKeymap, ...defaultKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          if (app.exercise) store.set(`css:${app.exercise.id}`, u.state.doc.toString());
          schedulePreview();
        }
      }),
    ],
  }),
});

// Handy for debugging from the browser console.
window.teiEditor = editor;

darkQuery.addEventListener("change", () => {
  for (const v of [editor, cssEditor]) v.dispatch({ effects: themeCompartment.reconfigure(editorTheme()) });
});

function setEditorText(text) {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
}

// ---------------------------------------------------------------- status & problems

function renderStatus(result) {
  const wf = $("#status-wf");
  const valid = $("#status-valid");
  const syntaxCount = result.errors.filter((e) => e.kind === "syntax").length;
  wf.className = "status-pill " + (result.wellFormed ? "ok" : "bad");
  wf.querySelector(".label").textContent = result.wellFormed ? "Well-formed" : `Not well-formed (${syntaxCount})`;
  if (!result.wellFormed) {
    valid.className = "status-pill muted";
    valid.querySelector(".label").textContent = "Validity: fix XML first";
  } else if (result.valid === null) {
    valid.className = "status-pill muted";
    valid.querySelector(".label").textContent = "Loading TEI schema…";
  } else {
    valid.className = "status-pill " + (result.valid ? "ok" : "bad");
    valid.querySelector(".label").textContent = result.valid ? "Valid TEI" : `Invalid TEI (${result.errors.length})`;
  }
  const count = result.errors.length;
  const badge = $("#problems-count");
  badge.textContent = count ? String(count) : "";
  badge.hidden = !count;
}

function renderProblems(result) {
  const list = $("#problems-list");
  const empty = $("#problems-empty");
  list.replaceChildren();
  if (!result.errors.length) {
    empty.hidden = false;
    empty.textContent = result.valid === null && result.wellFormed
      ? "The document is well-formed. The TEI schema is still loading…"
      : "No problems: the document is well-formed and valid against TEI All.";
    return;
  }
  empty.hidden = true;
  if (!result.wellFormed) {
    list.append(el("li", { class: "problem-note" }, "Fix this error first: the document is checked further once it is well-formed."));
  }
  result.errors.forEach((e) => {
    const item = el(
      "li",
      { class: `problem problem-${e.kind}` },
      el(
        "button",
        { type: "button", onclick: () => jumpTo(e.line, e.col) },
        el("span", { class: "problem-loc" }, `Line ${e.line}`),
        el("span", { class: "problem-kind" }, e.kind === "syntax" ? "XML" : "TEI"),
        el("span", { class: "problem-msg" }, e.message),
      ),
    );
    if (e.hint) item.append(el("div", { class: "problem-hint" }, el("span", {}, "Allowed here: "), e.hint));
    list.append(item);
  });
}

// ---------------------------------------------------------------- documents

function exerciseById(id) {
  return app.manifest.exercises.find((x) => x.id === id) || app.manifest.exercises[0] || null;
}

function workspace() {
  return store.get("files", {});
}

function saveCurrent() {
  if (!app.doc) return;
  const files = workspace();
  files[app.doc.key] = { ...app.doc, text: editor.state.doc.toString(), updated: Date.now() };
  const ok = store.set("files", files);
  $("#save-state").textContent = ok ? "Saved in this browser" : "Not saved (browser storage unavailable): download your file!";
  $("#save-state").classList.toggle("warn", !ok);
}

async function openDocument(key) {
  const files = workspace();
  const saved = files[key];
  let doc;
  let text;
  if (saved) {
    doc = { key, filename: saved.filename, origin: saved.origin, exerciseId: saved.exerciseId };
    text = saved.text;
  } else {
    const [exId, ...rest] = key.split("/");
    const ex = exerciseById(exId);
    const file = rest.join("/");
    if (!ex || !ex.files.some((f) => f.file === file)) return false;
    const origin = `${ex.folder}/${file}`;
    text = await fetchText(origin);
    doc = { key, filename: file, origin, exerciseId: ex.id };
  }
  app.doc = doc;
  store.set("last", key);
  if (doc.exerciseId && (!app.exercise || app.exercise.id !== doc.exerciseId)) await selectExercise(doc.exerciseId, { keepDoc: true });
  setEditorText(text);
  setFilenameField(doc.filename);
  renderDocMenu();
  saveCurrent();
  revalidate(editor);
  return true;
}

function renderDocMenu() {
  const select = $("#doc-select");
  select.replaceChildren();
  const ex = app.exercise;
  const files = workspace();
  if (ex) {
    const g = el("optgroup", { label: "Exercise files" });
    for (const f of ex.files) {
      const key = `${ex.id}/${f.file}`;
      g.append(el("option", { value: key }, f.label + (files[key] ? " ✎" : "")));
    }
    select.append(g);
  }
  const mine = Object.entries(files).filter(([k, v]) => k.startsWith("my/") && (!ex || v.exerciseId === ex.id));
  if (mine.length) {
    const g = el("optgroup", { label: "My documents" });
    for (const [k, v] of mine.sort((a, b) => a[1].filename.localeCompare(b[1].filename))) g.append(el("option", { value: k }, v.filename));
    select.append(g);
  }
  if (app.doc) select.value = app.doc.key;
  $("#btn-delete").hidden = !(app.doc && app.doc.key.startsWith("my/"));
  $("#btn-reset").hidden = !(app.doc && app.doc.origin);
}

const NEW_DOC_NAME = "empty_tei_all.xml";

// Documents are stored per exercise, so each exercise can have its own
// empty_tei_all.xml; within an exercise a repeated name gets "-2", "-3", ...
function uniqueKey(filename, exId) {
  const files = workspace();
  const scope = exId || "none";
  const taken = new Set(Object.values(files).filter((f) => f.exerciseId === exId && f.key && f.key.startsWith("my/")).map((f) => f.filename));
  let name = filename;
  let i = 2;
  while (taken.has(name) || files[`my/${scope}/${name}`]) name = filename.replace(/(\.xml)?$/, `-${i++}$1`);
  return { key: `my/${scope}/${name}`, filename: name };
}

function createDocument(filename, text) {
  if (!/\.xml$/i.test(filename)) filename += ".xml";
  const exerciseId = app.exercise ? app.exercise.id : null;
  const { key, filename: name } = uniqueKey(filename, exerciseId);
  const files = workspace();
  files[key] = { key, filename: name, origin: null, exerciseId, text, updated: Date.now() };
  store.set("files", files);
  return openDocument(key);
}

// The file name box grows with the name (monospace, so 1ch per character,
// plus room for the padding and border).
function fitFilenameField() {
  const input = $("#filename");
  input.style.width = `calc(${Math.min(Math.max(input.value.length + 1, 18), 48)}ch + 20px)`;
  input.title = input.value;
}

function setFilenameField(name) {
  $("#filename").value = name;
  fitFilenameField();
}

function downloadCurrent() {
  if (!app.doc) return;
  const name = ($("#filename").value || app.doc.filename || "document.xml").trim();
  const blob = new Blob([editor.state.doc.toString()], { type: "application/xml" });
  const a = el("a", { href: URL.createObjectURL(blob), download: /\.xml$/i.test(name) ? name : name + ".xml" });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

async function selectExercise(id, { keepDoc = false } = {}) {
  const ex = exerciseById(id);
  app.exercise = ex;
  store.set("exercise", ex ? ex.id : null);
  $("#exercise-select").value = ex ? ex.id : "";
  renderResources();
  await loadCss();
  if (!keepDoc && ex) {
    await openStarter(ex);
  } else {
    renderDocMenu();
  }
}

// The student's most recent document for an exercise, or a new TEI All
// document (like oXygen's File → New) if they have none yet.
async function openStarter(ex) {
  const files = workspace();
  const mine = Object.keys(files)
    .filter((k) => k.startsWith("my/") && files[k].exerciseId === ex.id)
    .sort((a, b) => (files[b].updated || 0) - (files[a].updated || 0))[0];
  if (mine) return openDocument(mine);
  return createDocument(ex.newDocument || NEW_DOC_NAME, TEI_TEMPLATE);
}

// ---------------------------------------------------------------- dialogs

function askElementName(title, names, done) {
  const dialog = $("#name-dialog");
  const input = $("#name-input");
  const list = $("#name-list");
  $("#name-title").textContent = title;
  list.replaceChildren(...names.sort((a, b) => a.localeCompare(b)).map((n) => el("option", { value: n })));
  $("#name-help").textContent = names.length ? `${names.length} elements are allowed here. Start typing to filter.` : "";
  input.value = "";
  dialog.returnValue = "";
  dialog.onclose = () => done(dialog.returnValue === "ok" ? input.value.trim().replace(/^<|>$/g, "") : null);
  dialog.showModal();
  input.focus();
}

function askText(title, value, done) {
  const dialog = $("#text-dialog");
  const input = $("#text-input");
  $("#text-title").textContent = title;
  input.value = value;
  dialog.returnValue = "";
  dialog.onclose = () => done(dialog.returnValue === "ok" ? input.value.trim() : null);
  dialog.showModal();
  input.select();
}

// ---------------------------------------------------------------- panels

function showTab(name) {
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  }
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== `panel-${name}`;
  store.set("tab", name);
  if (name === "preview") renderPreview();
  if (name === "css") cssEditor.requestMeasure();
}

// XPath
function renderXPath() {
  const expr = $("#xpath-input").value;
  const out = $("#xpath-results");
  const res = runXPath(editor.state.doc.toString(), expr);
  out.replaceChildren();
  if (!res.ok) {
    out.append(el("p", { class: "xpath-error" }, res.error));
    return;
  }
  if (res.type !== "nodes") {
    out.append(el("p", { class: "xpath-summary" }, `Result (${res.type}): `, el("code", {}, String(res.value))));
    return;
  }
  out.append(el("p", { class: "xpath-summary" }, `${res.items.length} result${res.items.length === 1 ? "" : "s"}`));
  const ol = el("ol", { class: "xpath-list" });
  for (const item of res.items) {
    ol.append(
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", onclick: () => item.line && jumpTo(item.line, item.col) },
          el("span", { class: "problem-loc" }, item.line ? `Line ${item.line}` : item.kind),
          el("code", {}, item.preview || "(empty)"),
        ),
      ),
    );
  }
  out.append(ol);
}

// Preview with the exercise CSS (oXygen's "Author mode" / opening the file in a browser)
let previewUrl = null;
let cssUrl = null;
let baseCssUrl = null;
// Default font for the preview: Noto Serif renders historical combining marks
// (e.g. u + U+0364) that Times and other system serif fonts show as boxes.
function previewBaseCss() {
  if (!baseCssUrl) {
    const font = new URL("fonts/NotoSerif-Regular.woff2", location.href).href;
    const cssText = `@font-face { font-family: "TEI Serif"; src: url("${font}") format("woff2"); }\n:root { font-family: "TEI Serif", serif; }\n`;
    baseCssUrl = URL.createObjectURL(new Blob([cssText], { type: "text/css" }));
  }
  return baseCssUrl;
}
// Like a real browser, the preview only uses a stylesheet the document links
// with <?xml-stylesheet?>; a link to the exercise CSS uses the CSS tab's text.
function stylesheetLinks(text) {
  const links = [];
  const re = /<\?xml-stylesheet\s([\s\S]*?)\?>/g;
  let m;
  while ((m = re.exec(text))) {
    const href = (/\bhref\s*=\s*(["'])(.*?)\1/.exec(m[1]) || [])[2] || "";
    const type = (/\btype\s*=\s*(["'])(.*?)\1/.exec(m[1]) || [])[2] || "";
    links.push({ start: m.index, end: m.index + m[0].length, href, type });
  }
  return links;
}

function stylesheetPI() {
  const name = (app.exercise && app.exercise.css) || "visualize-tei-xml.css";
  return `<?xml-stylesheet type="text/css" href="${name}"?>`;
}

function insertStylesheetLink() {
  const text = editor.state.doc.toString();
  // Before the root element, i.e. the first "<" that is not "<?" or "<!".
  const m = /<(?![?!])/.exec(text);
  const at = m ? m.index : 0;
  const insert = stylesheetPI() + "\n";
  editor.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length - 1 }, scrollIntoView: true });
  editor.focus();
  toast("Stylesheet link added before the root element.");
}

function previewBanner(content) {
  const banner = $("#preview-banner");
  banner.replaceChildren(...(content || []));
  banner.hidden = !content;
}

function renderPreview() {
  if ($("#panel-preview").hidden) return;
  const frame = $("#preview-frame");
  const msg = $("#preview-msg");
  const text = editor.state.doc.toString();
  if (app.lastResult && !app.lastResult.wellFormed) {
    msg.hidden = false;
    msg.textContent = "The preview appears when the document is well-formed.";
    frame.hidden = true;
    $("#preview-raw").hidden = true;
    previewBanner(null);
    return;
  }
  msg.hidden = true;
  const raw = $("#preview-raw");

  const exerciseCss = (app.exercise && app.exercise.css) || "visualize-tei-xml.css";
  const links = stylesheetLinks(text).filter((l) => !l.type || /css/i.test(l.type) || /\.css$/i.test(l.href));
  let body = text;
  let styled = false;
  // Replace links from the end so earlier offsets stay valid.
  for (const link of [...links].reverse()) {
    const file = link.href.split(/[\\/]/).pop();
    let href = null;
    if (file === exerciseCss) {
      if (cssUrl) URL.revokeObjectURL(cssUrl);
      cssUrl = URL.createObjectURL(new Blob([cssEditor.state.doc.toString()], { type: "text/css" }));
      href = cssUrl;
    } else if (/^https?:\/\//.test(link.href)) {
      href = link.href;
    }
    if (href) {
      styled = true;
      body = body.slice(0, link.start) + `<?xml-stylesheet type="text/css" href="${href}"?>` + body.slice(link.end);
    } else {
      body = body.slice(0, link.start) + body.slice(link.end);
    }
  }

  if (!links.length) {
    previewBanner([
      el("strong", {}, "No stylesheet is linked, "),
      "so the browser shows only the XML. To style it, add this line before ",
      el("code", {}, "<TEI>"),
      ": ",
      el("code", { class: "pi" }, stylesheetPI()),
      el("button", { type: "button", class: "btn btn-small", onclick: insertStylesheetLink }, "Add it for me"),
    ]);
  } else if (!styled) {
    const names = links.map((l) => `"${l.href}"`).join(", ");
    previewBanner([
      el("strong", {}, "Stylesheet not found: "),
      `${names}. The stylesheet of this exercise is called `,
      el("code", {}, exerciseCss),
      ". Check the spelling of the href.",
    ]);
  } else {
    previewBanner(null);
  }

  // Without a stylesheet a browser shows the bare XML (Chrome does not do this
  // inside an iframe, so render it ourselves).
  frame.hidden = !styled;
  raw.hidden = styled;
  if (!styled) {
    raw.textContent = text;
    const oldUrl = previewUrl;
    previewUrl = URL.createObjectURL(new Blob([body], { type: "application/xml" }));
    if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
    return;
  }
  {
    // Default font that can render historical characters; the linked CSS overrides it.
    const base = `<?xml-stylesheet type="text/css" href="${previewBaseCss()}"?>\n`;
    const first = stylesheetLinks(body)[0];
    body = body.slice(0, first.start) + base + body.slice(first.start);
  }
  const old = previewUrl;
  previewUrl = URL.createObjectURL(new Blob([body], { type: "application/xml" }));
  frame.src = previewUrl;
  if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
}
const schedulePreview = debounce(renderPreview, 600);

async function loadCss() {
  const ex = app.exercise;
  let text = ex ? store.get(`css:${ex.id}`) : null;
  if (text === null && ex && ex.css) {
    try {
      text = await fetchText(`${ex.folder}/${ex.css}`);
    } catch (e) {
      text = "";
    }
  }
  cssEditor.dispatch({ changes: { from: 0, to: cssEditor.state.doc.length, insert: text || "" } });
}

async function resetCss() {
  if (!app.exercise) return;
  store.remove(`css:${app.exercise.id}`);
  await loadCss();
  toast("Stylesheet restored.");
}

// Resources: transcripts, scans, tables
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell.trim()); cell = ""; }
    else if (c === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x));
}

function renderResources() {
  const list = $("#resource-list");
  const view = $("#resource-view");
  list.replaceChildren();
  view.replaceChildren();
  const ex = app.exercise;
  if (!ex) return;
  for (const r of ex.resources || []) {
    const url = `${ex.folder}/${r.file}`;
    const isPdf = /\.pdf$/i.test(r.file);
    list.append(
      el(
        "li",
        {},
        el("button", { type: "button", class: "resource-btn", onclick: () => showResource(r, url) }, isPdf ? "📄 " : /\.csv$/i.test(r.file) ? "▦ " : "✎ ", r.label),
        isPdf ? el("a", { href: url, target: "_blank", rel: "noopener", class: "resource-ext", title: "Open in a new tab" }, "↗") : null,
      ),
    );
  }
}

async function showResource(r, url) {
  const view = $("#resource-view");
  view.replaceChildren(el("p", { class: "muted" }, "Loading…"));
  try {
    if (/\.pdf$/i.test(r.file)) {
      view.replaceChildren(
        el("div", { class: "resource-head" }, el("strong", {}, r.label), el("a", { href: url, target: "_blank", rel: "noopener" }, "Open in new tab ↗")),
        el("iframe", { class: "pdf-frame", src: url, title: r.label }),
      );
      return;
    }
    const text = await fetchText(url);
    if (/\.csv$/i.test(r.file)) {
      const rows = parseCsv(text);
      const table = el("table", { class: "csv" });
      rows.forEach((cells, i) => table.append(el("tr", {}, cells.map((c) => el(i ? "td" : "th", {}, c)))));
      view.replaceChildren(el("div", { class: "resource-head" }, el("strong", {}, r.label)), el("div", { class: "table-wrap" }, table));
      return;
    }
    const copy = el("button", { type: "button", class: "btn btn-small" }, "Copy text");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Transcript copied: paste it into your document.");
      } catch (e) {
        toast("Select the text and copy it with Ctrl/Cmd+C.");
      }
    });
    view.replaceChildren(el("div", { class: "resource-head" }, el("strong", {}, r.label), copy), el("pre", { class: "transcript" }, text));
  } catch (e) {
    view.replaceChildren(el("p", { class: "xpath-error" }, `Could not load ${r.file}.`));
  }
}

// ---------------------------------------------------------------- resizable split

function wireSplitter() {
  const splitter = $("#splitter");
  const workspace = $(".workspace");
  const DEFAULT = 55;
  const apply = (pct) => {
    pct = Math.min(80, Math.max(20, pct));
    workspace.style.setProperty("--split", pct + "%");
    splitter.setAttribute("aria-valuenow", String(Math.round(pct)));
    return pct;
  };
  let current = apply(store.get("split", DEFAULT));
  const save = () => store.set("split", current);
  const remeasure = () => {
    editor.requestMeasure();
    cssEditor.requestMeasure();
  };

  let lastDown = 0;
  const reset = () => {
    current = apply(DEFAULT);
    save();
    remeasure();
  };
  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // preventDefault suppresses "dblclick", so detect the double-click here.
    if (e.timeStamp - lastDown < 400) {
      lastDown = 0;
      reset();
      return;
    }
    lastDown = e.timeStamp;
    splitter.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => {
      current = apply(((ev.clientX - rect.left) / rect.width) * 100);
      remeasure();
    };
    const up = () => {
      document.body.classList.remove("resizing");
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      save();
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
  splitter.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") current = apply(current - step);
    else if (e.key === "ArrowRight") current = apply(current + step);
    else if (e.key === "Home") current = apply(20);
    else if (e.key === "End") current = apply(80);
    else return;
    e.preventDefault();
    save();
    remeasure();
  });
}

// ---------------------------------------------------------------- wiring

function wireUi() {
  wireSplitter();
  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
  });

  $("#exercise-select").addEventListener("change", (e) => selectExercise(e.target.value));
  $("#doc-select").addEventListener("change", (e) => openDocument(e.target.value));
  $("#filename").addEventListener("input", fitFilenameField);
  $("#filename").addEventListener("change", (e) => {
    if (!app.doc) return;
    let name = e.target.value.trim() || app.doc.filename;
    if (!/\.xml$/i.test(name)) name += ".xml";
    setFilenameField(name);
    app.doc.filename = name;
    saveCurrent();
    renderDocMenu();
  });

  $("#btn-new").addEventListener("click", () =>
    askText("Name of the new TEI document", (app.exercise && app.exercise.newDocument) || NEW_DOC_NAME, (name) => name && createDocument(name, TEI_TEMPLATE)),
  );
  $("#btn-open").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await createDocument(file.name, text);
    toast(`Opened ${file.name}`);
  });
  $("#btn-download").addEventListener("click", downloadCurrent);
  $("#btn-reset").addEventListener("click", async () => {
    if (!app.doc || !app.doc.origin) return;
    if (!confirm("Discard your changes to this file and restore the original version?")) return;
    const text = await fetchText(app.doc.origin);
    setEditorText(text);
    saveCurrent();
    toast("Original version restored.");
  });
  $("#btn-delete").addEventListener("click", async () => {
    if (!app.doc || !app.doc.key.startsWith("my/")) return;
    if (!confirm(`Delete "${app.doc.filename}" from this browser? Download it first if you want to keep it.`)) return;
    const files = workspace();
    delete files[app.doc.key];
    store.set("files", files);
    app.doc = null;
    await selectExercise(app.exercise.id);
  });

  $("#btn-wrap").addEventListener("click", () => wrapSelection(editor));
  $("#btn-split").addEventListener("click", () => {
    splitElement(editor);
    editor.focus();
  });
  $("#btn-format").addEventListener("click", () => formatDocument(editor));
  $("#btn-suggest").addEventListener("click", () => {
    editor.focus();
    startCompletion(editor);
  });

  $("#xpath-form").addEventListener("submit", (e) => {
    e.preventDefault();
    renderXPath();
  });
  for (const chip of document.querySelectorAll(".xpath-example")) {
    chip.addEventListener("click", () => {
      $("#xpath-input").value = chip.textContent;
      renderXPath();
    });
  }
  $("#btn-css-reset").addEventListener("click", resetCss);
  $("#btn-preview-refresh").addEventListener("click", renderPreview);
  $("#btn-preview-open").addEventListener("click", () => {
    renderPreview();
    if (previewUrl) window.open(previewUrl, "_blank", "noopener");
  });

  for (const d of document.querySelectorAll("dialog")) {
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
    // Enter confirms (a plain form submit would pick the first button, "Cancel").
    d.querySelector("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        d.close("ok");
      }
    });
  }
}

async function init() {
  wireUi();
  showTab(store.get("tab", "problems"));
  renderStatus({ wellFormed: true, valid: null, errors: [] });

  // The grammar is the slow part; load it in parallel and re-lint when ready.
  const grammarPromise = fetchText("schema/tei_all.json")
    .then((json) => {
      app.grammar = loadGrammar(json);
      revalidate(editor);
    })
    .catch((e) => {
      console.error(e);
      toast("Could not load the TEI schema: only well-formedness is checked.", "error");
    });
  fetch("schema/tei_docs.json")
    .then((r) => r.json())
    .then((d) => {
      app.docs = d;
      $("#schema-version").textContent = d.version ? `TEI P5 ${d.version.replace(/^P5 Version /, "")}` : "";
    })
    .catch(() => {});

  try {
    app.manifest = JSON.parse(await fetchText("exercises/manifest.json"));
  } catch (e) {
    app.manifest = { exercises: [] };
  }
  const exSelect = $("#exercise-select");
  exSelect.replaceChildren(...app.manifest.exercises.map((x) => el("option", { value: x.id }, x.title)));

  const last = store.get("last");
  const exId = store.get("exercise", app.manifest.exercises[0] && app.manifest.exercises[0].id);
  app.exercise = exerciseById(exId);
  if (app.exercise) exSelect.value = app.exercise.id;
  renderResources();
  await loadCss();
  let opened = false;
  if (last) opened = await openDocument(last).catch(() => false);
  if (!opened && app.exercise) opened = await openStarter(app.exercise);
  if (!opened) await createDocument(NEW_DOC_NAME, TEI_TEMPLATE);
  editor.focus();
  await grammarPromise;
}

init();
