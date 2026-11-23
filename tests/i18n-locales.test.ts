// Archivos de idioma (1.4): completos, con los mismos valores {{…}}, plurales y elección del idioma.
import en from "../src/i18n/locales/en.json";
import es from "../src/i18n/locales/es.json";
import { currentLanguage, numberLocale, T } from "../src/i18n";
import { setLocale, t } from "./helpers";

const enKeys = Object.keys(en);
const esKeys = Object.keys(es);
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
const esMap = es as Record<string, string>;
const enMap = en as Record<string, string>;

t("es.json tiene todas las claves de en.json", enKeys.filter((k) => !(k in es)), []);
t("es.json no tiene claves que no estén en en.json", esKeys.filter((k) => !(k in en)), []);
t("los mismos valores {{…}} en los dos idiomas", enKeys.filter((k) => k in es && vars(enMap[k]) !== vars(esMap[k])), []);
t("ninguna clave de plural sin su variante _other", enKeys.filter((k) => /_(one|few|many|two|zero)$/.test(k) && !(k.replace(/_[a-z]+$/, "_other") in en)), []);

// Cualquier otro idioma que se añada (src/i18n/locales/<código>.json): puede estar incompleto (lo que falta
// sale en inglés), pero solo con claves de en.json (o variantes de plural de una de ellas) y los mismos {{…}}.
const fs = require("node:fs") as typeof import("node:fs");
const dir = "src/i18n/locales";
const plurals = new Set(enKeys.filter((k) => k.endsWith("_other")).map((k) => k.slice(0, -"_other".length)));
for (const name of fs.readdirSync(dir).filter((f: string) => f.endsWith(".json") && f !== "en.json")) {
	const texts = JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8")) as Record<string, string>;
	const known = (k: string) => k in en || plurals.has(k.replace(/_(zero|one|two|few|many|other)$/, ""));
	t(`${name}: solo claves conocidas`, Object.keys(texts).filter((k) => !known(k)), []);
	const base = (k: string) => (k in en ? k : `${k.replace(/_(zero|one|two|few|many|other)$/, "")}_other`);
	t(`${name}: los mismos {{…}} que en inglés`, Object.keys(texts).filter((k) => known(k) && vars(texts[k]) !== vars(enMap[base(k)])), []);
}

// Elección del idioma.
setLocale("es");
t("es: español", currentLanguage(), "es");
setLocale("es-mx");
t("es-mx: español (sin región)", currentLanguage(), "es");
setLocale("fr");
t("fr (sin traducción): inglés", currentLanguage(), "en");
t("fr: los números en inglés", numberLocale(), "en");
setLocale("");
t("sin idioma: inglés", currentLanguage(), "en");

// Textos, valores y plurales.
setLocale("es");
t("texto en español", T("mapView.navigate"), "Navegar");
t("con valores", T("main.iconsImported", { count: 3 }), "3 iconos importados.");
t("plural: uno", T("main.iconsImported", { count: 1 }), "1 icono importado.");
t("plural: varios", T("tracker.rounds", { count: 2 }), "2 rondas");
t("valor vacío: nada (no «undefined»)", T("mapModals.segmentDistanceUnit", { unit: undefined }), "Distancia ()");
setLocale("en");
t("plural en inglés: uno", T("tracker.rounds", { count: 1 }), "1 round");
t("plural en inglés: varios", T("tracker.rounds", { count: 5 }), "5 rounds");
setLocale("es");
