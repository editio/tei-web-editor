// Bundles src/ into site/app.js (one self-contained ES module, no CDN needed).
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  outfile: "site/app.js",
  logLevel: "info",
});
