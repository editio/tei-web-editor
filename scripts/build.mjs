// Bundles src/ into site/app.js (one self-contained ES module, no CDN needed)
// and writes site/THIRD_PARTY_NOTICES.txt with the licences of everything bundled.
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const result = await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  metafile: true,
  outfile: "site/app.js",
  logLevel: "info",
});

// Packages that ended up in the bundle, plus xregexp, which salve's own
// pre-built bundle contains.
const packages = new Set(["xregexp"]);
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) packages.add(m[1]);
}
const sections = [...packages].sort().map((name) => {
  const dir = path.join("node_modules", name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  // Some packages ship without a licence file; copies are kept in scripts/licenses/.
  const fallback = path.join("scripts", "licenses", `${name.replace("/", "__")}.txt`);
  const text = file
    ? fs.readFileSync(path.join(dir, file), "utf8").trim()
    : fs.existsSync(fallback)
      ? fs.readFileSync(fallback, "utf8").trim()
      : `License: ${pkg.license}`;
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository && pkg.repository.url;
  return `${name} ${pkg.version} (${pkg.license})${repo ? "\n" + repo.replace(/^git\+/, "") : ""}\n\n${text}`;
});
const header = `Third-party software bundled in app.js
=====================================

The TEI Web Editor (MIT, see LICENSE in the repository) bundles the
following packages. salve-annos is used unmodified; its source code is
available at https://github.com/raffazizzi/salve (MPL-2.0).
`;
fs.writeFileSync("site/THIRD_PARTY_NOTICES.txt", header + "\n" + sections.map((s) => "-".repeat(72) + "\n" + s).join("\n\n") + "\n");
console.log(`  site/THIRD_PARTY_NOTICES.txt (${packages.size} packages)`);
