import assert from "node:assert/strict";
import { test } from "node:test";
import type StrakesTTRPG from "../src/main";
import type { StrakesSettings } from "../src/types";

/**
 * Comprobación con nombre: `t("descripción", valorObtenido, valorEsperado)`.
 * Compara en JSON y toma la «foto» del valor en el momento de la llamada, así que se puede
 * seguir modificando el mismo objeto después (los tests del tracker lo hacen paso a paso).
 */
export function t(name: string, got: unknown, expected: unknown): void {
	const g = JSON.stringify(got);
	const e = JSON.stringify(expected);
	void test(name, () => assert.equal(g, e));
}

/**
 * Plugin falso para el tracker de iniciativa: solo los ajustes que usa, `saveSettings` y
 * `events.trigger`. Cada llamada devuelve uno nuevo, con el combate vacío.
 */
export function fakePlugin(): StrakesTTRPG {
	const settings: Pick<StrakesSettings, "customConditions" | "conditionOverrides" | "portraitMemory" | "combat"> = {
		customConditions: [],
		conditionOverrides: {},
		portraitMemory: {},
		combat: { combatants: [], currentId: null, round: 1 },
	};
	const plugin = {
		settings,
		saveSettings: (): Promise<void> => Promise.resolve(),
		events: { trigger: (): void => {} },
	};
	return plugin as unknown as StrakesTTRPG;
}

/** Avisos (Notice) mostrados desde el último `clearNotices()`. */
export function notices(): string[] {
	return (globalThis as { __NOTICES?: string[] }).__NOTICES ?? [];
}

export function clearNotices(): void {
	(globalThis as { __NOTICES?: string[] }).__NOTICES = [];
}

/** Cambia el idioma de la interfaz que ve el plugin ("es", "en", "tr"…). */
export function setLocale(locale: string): void {
	(globalThis as { __LOC?: string }).__LOC = locale;
}
