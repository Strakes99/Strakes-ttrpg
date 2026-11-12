import { moment } from "obsidian";

/**
 * Idioma de la interfaz: español si Obsidian está en español; inglés en cualquier otro
 * caso (también para idiomas sin traducción, p. ej. turco).
 */
export type Lang = "es" | "en";

export interface Localized {
	es: string;
	en: string;
}

export function lang(): Lang {
	const locale = (moment.locale() || "").toLowerCase();
	return locale.startsWith("es") ? "es" : "en";
}

export function tr(text: Localized): string {
	return text[lang()];
}

/**
 * Texto de la interfaz en los dos idiomas: `T("Abrir mapa", "Open map")`.
 * En mayúscula para no chocar con los parámetros `t` (p. ej. `addText((t) => …)`).
 */
export function T(es: string, en: string): string {
	return lang() === "es" ? es : en;
}

/** Locale para formatear números (separador decimal, etc.). */
export function numberLocale(): string {
	return lang() === "es" ? "es" : "en";
}
