/**
 * Sustituto mínimo del módulo "obsidian" para ejecutar la lógica del plugin fuera de la
 * aplicación. `tests/run.mjs` lo inyecta en lugar del paquete real al empaquetar los tests.
 * Solo contiene lo que importan los módulos que se prueban: si un test nuevo importa algo
 * más de Obsidian, añádelo aquí.
 */

const g = globalThis as { __LOC?: string; __NOTICES?: string[] };

/** Idioma: "es" por defecto (los textos esperados de los tests están en español). */
export const moment = { locale: (): string => g.__LOC ?? "es" };

/** Los avisos se guardan en globalThis.__NOTICES para poder comprobarlos (ver helpers.ts). */
export class Notice {
	constructor(message: string) {
		(g.__NOTICES ??= []).push(message);
	}
}

export class Modal {
	constructor(public app: unknown) {}
}
export class FuzzySuggestModal {
	constructor(public app: unknown) {}
}
export class AbstractInputSuggest {}
export class Setting {}
export class TFile {}
export class FileSystemAdapter {}

export const normalizePath = (path: string): string => path;
export const setIcon = (): void => {};
export const getIconIds = (): string[] => [];
