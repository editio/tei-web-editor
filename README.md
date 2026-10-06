# TEI Web Editor

**Live:** <https://editio.github.io/tei-web-editor/>

A browser-only TEI XML editor for teaching. Students open a web page and edit there, with nothing to install. The page provides:

- **Live checking while typing**: well-formedness and validity against **TEI All** (Relax NG), shown as green/red indicators like oXygen's. Errors are underlined, listed in a *Problems* tab, and give the elements that are allowed at that point.
- **Schema-aware completion**: typing `<` shows the elements allowed at the cursor, a space inside a start tag shows the attributes, and closed value lists are offered (e.g. `@cert`). `@ref`/`@corresp`/… suggest the `#xml:id`s defined in the document. Each suggestion comes with its TEI Guidelines description.
- **oXygen-like actions**: *Surround with element* (Ctrl/Cmd+E), *Split element* (Alt+Shift+D), *Format & indent* (Ctrl/Cmd+Shift+F or +P), and auto-closing tags.
- **XPath box** (XPath 1.0, the TEI namespace is the default, so `//l` works).
- **Preview** that behaves like a browser: the document is styled only once it links the stylesheet with `<?xml-stylesheet type="text/css" href="visualize-tei-xml.css"?>` (the *CSS* tab's version is used, so students can edit it). Without the link, the Preview shows the raw XML and explains how to add it.
- **Materials** tab with the exercise transcripts, scans (PDF), instructions and CSV tables.
- Work is autosaved **in the student's browser** (localStorage); *Download* saves the `.xml` file.

Everything runs client-side: no server-side code, no accounts, and no data leaves the browser.

## Deploying

`site/` is a static website. Upload the folder to any web host:

- **GitHub Pages** (used for the live version): the workflow in `.github/workflows/pages.yml` publishes `site/` on every push to `main` (*Settings → Pages → Source: GitHub Actions*).
- A university web server, Netlify Drop, or any other static hosting.

The page must be served over `http(s)://`. Opening `index.html` by double-clicking (`file://`) does not work because browsers block loading the schema that way. To try it locally:

```sh
npm run serve        # then open http://localhost:8000
```

Size: about 8.5 MB, most of it PDFs. With the gzip compression GitHub Pages applies, the editor itself (code + schema) is about 0.4 MB to download.

## Adding or changing exercises

Edit `site/exercises/manifest.json`. Each exercise has:

- `files`: XML documents that students can open (templates, solutions)
- `resources`: transcripts (`.txt`), scans/instructions (`.pdf`) and tables (`.csv`) shown in the *Materials* tab
- `css`: the stylesheet used by the *Preview*
- `newDocument`: name of the new TEI All document the editor opens the first time a student selects the exercise

Put the files in the exercise's `folder`. No rebuild is needed.

## Instructions for students

`instructions/` contains the exercise instructions adapted to the web editor (R Markdown sources and rendered PDFs). The PDFs are also copied into `site/exercises/` so they appear in the *Materials* tab. They point students to <https://editio.github.io/tei-web-editor/>. After editing an `.Rmd` file, re-render it and copy the PDFs again:

```sh
cd instructions
Rscript -e 'for (f in Sys.glob("*.Rmd")) rmarkdown::render(f, "pdf_document")'
cp 1.0-*.pdf 2.0-*.pdf ../site/exercises/ex1/ && cp 3.0-*.pdf 2.0-*.pdf ../site/exercises/ex3/
```

## Development

```sh
npm install
npm run build        # bundles src/ → site/app.js
npm run schema       # re-downloads tei_all.rng and regenerates site/schema/*
```

- `src/validator.mjs`: well-formedness (saxes) and Relax NG validation ([salve](https://github.com/raffazizzi/salve), the validator used by TEI Roma)
- `src/completion.mjs`: schema-aware suggestions at the cursor
- `src/format.mjs`: formatting that keeps mixed content untouched
- `src/xpath.mjs`: XPath panel
- `src/main.js`: UI (CodeMirror 6)

The schema is pre-compiled into `site/schema/tei_all.json`, so validating a document takes milliseconds. (Compiling `tei_all.rng` with libxml2/xmllint in the browser takes about 8 s per check.)

## Differences from oXygen worth telling students

| oXygen | TEI Web Editor |
|---|---|
| File → New → TEI All | **New** button |
| Green/red square (top right) | **Well-formed** / **Valid TEI** indicators in the toolbar |
| Ctrl/Cmd+E (surround with element) | Same shortcut, or *Surround with element* |
| Ctrl/Cmd+Shift+P (format & indent) | Same, or Ctrl/Cmd+Shift+F (Firefox reserves Ctrl/Cmd+Shift+P) |
| Document → Markup → Split Element | *Split element* (Alt+Shift+D) |
| XPath 2.0 toolbar | **XPath** tab (XPath 1.0: no `tokenize()`, `distinct-values()`, …) |
| Associate CSS + Author mode | Add the `<?xml-stylesheet?>` line (or *Add it for me*), then the **Preview** tab |
| Save | Autosaved in the browser; **Download** to keep or submit the file |

Not covered: Schematron rules embedded in TEI All (oXygen checks them too), and XSLT transformations.

## Licence

- Code: [MIT](LICENSE),
- Teaching materials (instructions, exercise files, transcriptions): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Scans, the TEI schema, fonts and bundled libraries keep their own terms: see [LICENSE-CONTENT.md](LICENSE-CONTENT.md) and [site/THIRD_PARTY_NOTICES.txt](site/THIRD_PARTY_NOTICES.txt)
