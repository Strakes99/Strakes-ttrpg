import { moment } from "obsidian";
import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * Traducciones de la interfaz (1.4). Cada idioma es un archivo `locales/<código>.json` con las claves de
 * `en.json`, que es el de referencia. Para añadir un idioma:
 *  1. copiar `en.json` como `<código>.json` (el código de idioma de Obsidian: `fr`, `de`, `pt-br`…) y
 *     traducir los textos, sin tocar las claves ni lo que va entre `{{…}}`;
 *  2. importarlo aquí y añadirlo a `LOCALES`.
 * Lo que falte en un idioma sale en inglés. Ver «Translations» en el README.
 *
 * Plurales: una clave con variantes `_one`, `_other` (y las que use el idioma: `_few`, `_many`…) se
 * pide sin sufijo y con `count`, p. ej. `T("tracker.rounds", { count: 3 })`; la variante sale de las
 * reglas de plural del idioma (`Intl.PluralRules`).
 */
const LOCALES: Record<string, Partial<Record<string, string>>> = { en, es };

type EnKey = keyof typeof en;
/** Clave con variantes de plural, sin el sufijo (`tracker.rounds` por `tracker.rounds_one` / `_other`). */
type PluralKey = EnKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;
/** Clave de un texto de la interfaz. El compilador avisa si no existe en `en.json`. */
export type TranslationKey = EnKey | PluralKey;

const english: Partial<Record<string, string>> = en;

/**
 * Idioma de la interfaz: el de Obsidian si hay traducción (código exacto, p. ej. `pt-br`, o el idioma
 * sin región, `pt`); si no, inglés.
 */
export function currentLanguage(): string {
	const locale = (moment.locale() || "en").toLowerCase();
	if (LOCALES[locale]) return locale;
	const base = locale.split(/[-_]/)[0];
	return LOCALES[base] ? base : "en";
}

/**
 * Texto de la interfaz en el idioma actual: `T("mapView.navigate")`, o con valores,
 * `T("main.iconsImported", { count: n })`, que sustituyen a `{{count}}` en el texto. En mayúscula para no
 * chocar con los parámetros `t` del código (p. ej. `addText((t) => …)`).
 */
export function T(key: TranslationKey, vars?: Record<string, string | number | null | undefined>): string {
	return translate(currentLanguage(), key, vars);
}

/**
 * Ajuste «Traducir el contenido» (1.4). Activado (por defecto), el contenido sale en el idioma de la
 * interfaz; desactivado, en inglés, y solo se traduce la interfaz. **Contenido** = lo que viene de las
 * reglas: todo lo dibujado en los statblocks (etiquetas, tamaños, tipos, características, habilidades,
 * daños, secciones…), los valores que se eligen en su formulario y el nombre y la descripción de las
 * condiciones del SRD. Lo fija el plugin al cargar y al cambiar el ajuste.
 */
let translateContent = true;
export function setTranslateContent(on: boolean): void {
	translateContent = on;
}

/** Idioma del contenido: el de la interfaz, o inglés si «Traducir el contenido» está desactivado. */
export function contentLanguage(): string {
	return translateContent ? currentLanguage() : "en";
}

/** Texto de contenido (ver `setTranslateContent`): como `T`, pero en el idioma del contenido. */
export function TC(key: TranslationKey, vars?: Record<string, string | number | null | undefined>): string {
	return translate(contentLanguage(), key, vars);
}

function translate(lang: string, key: TranslationKey, vars?: Record<string, string | number | null | undefined>): string {
	const texts = LOCALES[lang] ?? english;
	let k: string = key;
	if (vars && typeof vars.count === "number") {
		const form = `${key}_${new Intl.PluralRules(lang).select(vars.count)}`;
		k = form in texts || form in english ? form : `${key}_other`;
	}
	const text = texts[k] ?? english[k] ?? k;
	return vars ? text.replace(/\{\{(\w+)\}\}/g, (all, name: string) => (name in vars ? String(vars[name] ?? "") : all)) : text;
}

/** El texto de una clave en todos los idiomas (sin repetir), p. ej. los nombres de una condición del SRD para reconocerla escrita en cualquiera. */
export function translationsOf(key: string): string[] {
	return [...new Set(Object.values(LOCALES).map((texts) => texts[key]).filter((x): x is string => typeof x === "string"))];
}

/** Locale para formatear números (separador decimal, etc.): el del idioma de la interfaz. */
export function numberLocale(): string {
	return currentLanguage();
}
