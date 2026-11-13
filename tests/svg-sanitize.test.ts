// Saneado de SVG: lo peligroso se quita y lo legítimo se conserva.
import * as fs from "node:fs";
import * as path from "node:path";
import { t } from "./helpers";

// sanitizeSvg usa DOMParser y XMLSerializer, que en Node no existen: los aporta jsdom.
// jsdom no trae tipos (y @types/jsdom no está instalado): se declara solo lo que se usa.
type JsdomModule = { JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer } } };
const { JSDOM } = require("jsdom") as JsdomModule;
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as Record<string, unknown>;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
// require (no import) para cargarlo después de preparar DOMParser.
const { sanitizeSvg } = require("../src/map/icons") as typeof import("../src/map/icons");

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const contains = (out: string | null, s: string) => !!out && out.toLowerCase().includes(s.toLowerCase());

const attacks: [string, string, string[]][] = [
	["<style> con url externo", `<svg ${NS}><style>path{fill:url(http://evil.com/x.svg#a)}</style><path d="M0 0"/></svg>`, ["evil.com"]],
	["<style> con @import", `<svg ${NS}><style>@import url("https://evil.com/a.css");path{fill:red}</style></svg>`, ["@import", "evil.com"]],
	["style= con url externo", `<svg ${NS}><path style="fill:url('https://evil.com/p')" d="M0 0"/></svg>`, ["evil.com"]],
	["image-set externo", `<svg ${NS}><rect style="background:image-set('https://evil.com/a.png' 1x)"/></svg>`, ["evil.com"]],
	["CSS con escapes", `<svg ${NS}><style>path{fill:\\75rl(https://evil.com/x)}</style></svg>`, ["evil.com"]],
	["fill= con url externo", `<svg ${NS}><path fill="url(https://evil.com/g#x)" d="M0 0"/></svg>`, ["evil.com"]],
	["html:iframe con prefijo", `<svg ${NS} xmlns:html="http://www.w3.org/1999/xhtml"><html:iframe src="https://evil.com"/></svg>`, ["iframe", "evil.com"]],
	["html:img con src", `<svg ${NS} xmlns:h="http://www.w3.org/1999/xhtml"><h:img src="https://evil.com/t.png"/></svg>`, ["evil.com"]],
	["<set> cambia href a javascript", `<svg ${NS}><a href="#x"><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>`, ["javascript"]],
	["<animate> de xlink:href", `<svg ${NS}><a xlink:href="#x"><animate attributeName="xlink:href" values="javascript:alert(1)"/></a></svg>`, ["javascript"]],
	["href con prefijo distinto", `<svg ${NS} xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.com/s.svg#i"/></svg>`, ["evil.com"]],
	["<script> y onload", `<svg ${NS} onload="alert(1)"><script>alert(1)</script></svg>`, ["alert"]],
	["<SCRIPT> en mayúsculas", `<svg ${NS}><SCRIPT xmlns="http://www.w3.org/2000/svg">alert(1)</SCRIPT></svg>`, ["alert"]],
	["foreignObject", `<svg ${NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`, ["foreignobject", "<div"]],
	["<link> a CSS externo", `<svg ${NS}><link xmlns="http://www.w3.org/1999/xhtml" rel="stylesheet" href="https://evil.com/a.css"/></svg>`, ["evil.com"]],
];
for (const [name, svg, banned] of attacks) {
	const out = sanitizeSvg(svg);
	t(`bloquea: ${name}`, out !== null && banned.every((b) => !contains(out, b)), true);
}

const good = `<svg ${NS} viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><style>.a{fill:url(#g)}</style><path class="a" fill="url(#g)" style="stroke:url(#g)" d="M0 0"/><use href="#g"/><image href="data:image/png;base64,AAAA"/></svg>`;
const out = sanitizeSvg(good);
t("conserva url(#id) en <style>", contains(out, ".a{fill:url(#g)}"), true);
t("conserva fill=\"url(#id)\"", contains(out, 'fill="url(#g)"'), true);
t("conserva style con url(#id)", contains(out, "stroke:url(#g)"), true);
t("conserva <use href=\"#id\">", contains(out, 'href="#g"'), true);
t("conserva imágenes data:image", contains(out, "data:image/png"), true);
t("rechaza lo que no es SVG", sanitizeSvg("<html><body>hola</body></html>"), null);
t("añade viewBox desde width/height", contains(sanitizeSvg(`<svg ${NS} width="24" height="12"/>`), 'viewBox="0 0 24 12"'), true);

// Solo en la máquina del desarrollador: si existe la carpeta icons/ (no está en el repo),
// todos sus SVG tienen que seguir siendo aceptados.
const iconsDir = path.resolve(__dirname, "..", "icons");
if (fs.existsSync(iconsDir)) {
	const files: string[] = [];
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.isDirectory()) walk(path.join(d, e.name));
			else if (e.name.toLowerCase().endsWith(".svg")) files.push(path.join(d, e.name));
		}
	};
	walk(iconsDir);
	const rejected = files.filter((f) => sanitizeSvg(fs.readFileSync(f, "utf8")) === null).map((f) => path.relative(iconsDir, f));
	t(`los ${files.length} iconos de icons/ siguen siendo válidos`, rejected, []);
}
