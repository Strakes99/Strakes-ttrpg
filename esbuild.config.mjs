import esbuild from "esbuild";
import builtins from "builtin-modules";
import { readFileSync } from "node:fs";

const prod = process.argv[2] === "production";

// Leaflet va empaquetado en main.js: su licencia (BSD 2-Clause) exige reproducir su
// aviso de copyright en lo que se distribuye.
const leafletLicense = readFileSync("node_modules/leaflet/LICENSE", "utf8").trim();
const banner = [
  "/*",
  " * Strakes TTRPG — MIT License (see LICENSE). Includes SRD 5.2 material under CC-BY-4.0 (see README).",
  " *",
  " * Bundled third-party software: Leaflet (https://leafletjs.com/)",
  ...leafletLicense.split(/\r?\n/).map((line) => ` * ${line}`.trimEnd()),
  " */",
].join("\n");

const jsCtx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  banner: { js: banner },
  external: [
    "obsidian", "electron",
    "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
    "@codemirror/language", "@codemirror/lint", "@codemirror/search",
    "@codemirror/state", "@codemirror/view",
    "@lezer/common", "@lezer/highlight", "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
});

// Leaflet CSS + our CSS bundled into the single styles.css Obsidian loads.
// styles.css también lleva la hoja de estilos y las imágenes de Leaflet: mismo aviso.
const cssCtx = await esbuild.context({
  entryPoints: ["src/styles.css"],
  bundle: true,
  banner: { css: banner },
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  logLevel: "info",
  minify: prod,
  outfile: "styles.css",
});

if (prod) {
  await jsCtx.rebuild();
  await cssCtx.rebuild();
  process.exit(0);
} else {
  await jsCtx.watch();
  await cssCtx.watch();
}
