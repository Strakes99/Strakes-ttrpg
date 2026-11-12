import { moment } from "obsidian";

/**
 * Idioma del contenido bilingüe del plugin (por ahora, las condiciones).
 * Sigue el idioma de la interfaz de Obsidian: español si es «es…», inglés en otro caso.
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
