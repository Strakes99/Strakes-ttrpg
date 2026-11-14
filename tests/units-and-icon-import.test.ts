// Selector de unidades (mostrar y mapas nuevos) e importación de iconos con nombres repetidos.
import type { App } from "obsidian";
import { IconConflict, IconConflictChoice, IconLibrary } from "../src/map/icons";
import { displayDistance, newMapUnit, unitOptions } from "../src/map/mapData";
import { t } from "./helpers";

// ---------- Unidades ----------
t("opciones del selector", unitOptions().map((o) => o.value), ["km", "mi", "leguas", "m", "ft"]);
t("mapas nuevos: la unidad elegida", newMapUnit("mi"), "mi");
t("mapas nuevos con «Las de cada mapa»: km", newMapUnit("map"), "km");
t("mapas nuevos con una unidad desconocida: km", newMapUnit("días"), "km");
t("km → leguas", displayDistance(15, "km", "leguas"), "3,11 leguas");
t("leguas → km", displayDistance(2, "leguas", "km"), "9,66 km");
// El formato español no separa los miles en números de 4 cifras (1609,34).
t("mi → m", displayDistance(1, "mi", "m"), "1609,34 m");
t("km → ft", displayDistance(1, "km", "ft"), "3280,84 ft");
t("misma unidad con otro nombre: sin conversión", displayDistance(3.14, "kilómetros", "km"), "3,1 km");
t("«Las de cada mapa»: la del mapa", displayDistance(3.14, "leguas", "map"), "3,1 leguas");

// ---------- Importar iconos con nombres repetidos ----------
/** Sistema de archivos en memoria con lo que usa IconLibrary. */
function fakeApp(initial: string[]): { app: App; files: Map<string, string> } {
	const files = new Map(initial.map((p) => [p, "<svg xmlns='http://www.w3.org/2000/svg'/>"]));
	const adapter = {
		exists: (p: string) => Promise.resolve(files.has(p) || [...files.keys()].some((f) => f.startsWith(`${p}/`)) || p === "plugin/icons"),
		mkdir: () => Promise.resolve(),
		write: (p: string, text: string) => {
			files.set(p, text);
			return Promise.resolve();
		},
		read: (p: string) => Promise.resolve(files.get(p) ?? ""),
		list: (dir: string) => Promise.resolve({ files: [...files.keys()].filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes("/")), folders: [] }),
	};
	return { app: { vault: { adapter } } as unknown as App, files };
}
/** Un archivo elegido por el usuario (lo único que se usa: name y text()). */
const svgFile = (name: string) => ({ name, text: () => Promise.resolve("<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>") }) as unknown as File;
/** Respuestas del «diálogo» en orden, y lo que se le preguntó. */
function scripted(answers: IconConflictChoice[]): { ask: (c: IconConflict) => Promise<IconConflictChoice>; asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		ask: (c) => {
			asked.push(`${c.name}→${c.suggested} (quedan ${c.remaining})`);
			return Promise.resolve(answers.shift() ?? { action: "skip" });
		},
	};
}

// sanitizeSvg necesita DOMParser: sin él, los SVG se rechazan. Se prueba con jsdom.
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string) => { window: { DOMParser: unknown; XMLSerializer: unknown } } };
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
(globalThis as Record<string, unknown>).XMLSerializer = dom.window.XMLSerializer;

void (async () => {
	// Reemplazar.
	{
		const { app, files } = fakeApp(["plugin/icons/espada.svg"]);
		const lib = new IconLibrary(app, "plugin");
		const s = scripted([{ action: "replace" }]);
		const n = await lib.importFiles([svgFile("espada.svg")], "", s.ask);
		t("reemplazar: pregunta con el primer nombre libre", s.asked, ["espada→espada 2 (quedan 0)"]);
		t("reemplazar: se importa y no hay copia", [n, [...files.keys()].sort()], [1, ["plugin/icons/espada.svg"]]);
		t("reemplazar: el contenido es el nuevo", files.get("plugin/icons/espada.svg")?.includes("path"), true);
	}
	// Renombrar y omitir.
	{
		const { app, files } = fakeApp(["plugin/icons/espada.svg", "plugin/icons/escudo.svg"]);
		const lib = new IconLibrary(app, "plugin");
		const s = scripted([{ action: "rename", name: "espada larga" }, { action: "skip" }]);
		const n = await lib.importFiles([svgFile("espada.svg"), svgFile("escudo.svg"), svgFile("arco.svg")], "", s.ask);
		t("renombrar/omitir: solo pregunta por los repetidos", s.asked, ["espada→espada 2 (quedan 2)", "escudo→escudo 2 (quedan 1)"]);
		t("renombrar/omitir: importados", n, 2);
		t("renombrar/omitir: archivos", [...files.keys()].sort(), ["plugin/icons/arco.svg", "plugin/icons/escudo.svg", "plugin/icons/espada larga.svg", "plugin/icons/espada.svg"]);
	}
	// «Hacer lo mismo con el resto» al renombrar: los siguientes toman el primer nombre libre.
	{
		const { app, files } = fakeApp(["plugin/icons/a.svg", "plugin/icons/a 2.svg", "plugin/icons/b.svg"]);
		const lib = new IconLibrary(app, "plugin");
		const s = scripted([{ action: "rename", name: "a nueva", applyToRest: true }]);
		await lib.importFiles([svgFile("a.svg"), svgFile("b.svg")], "", s.ask);
		t("aplicar al resto: solo pregunta una vez", s.asked.length, 1);
		t("aplicar al resto: b va a «b 2»", files.has("plugin/icons/b 2.svg"), true);
		t("el primer nombre libre salta los ocupados («a 3»)", s.asked[0], "a→a 3 (quedan 1)");
	}
	// Sin diálogo nunca se sobrescribe.
	{
		const { app, files } = fakeApp(["plugin/icons/espada.svg"]);
		const lib = new IconLibrary(app, "plugin");
		await lib.importFiles([svgFile("espada.svg")]);
		t("sin diálogo: se guarda con otro nombre", files.has("plugin/icons/espada 2.svg"), true);
	}
})();
