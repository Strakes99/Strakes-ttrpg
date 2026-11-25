/**
 * Presets de presentación de los statblocks (1.4, paso 8; decidido por el desarrollador el 2026-11-25):
 * qué se muestra y en qué orden, las columnas por defecto y los metros.
 *
 * - «D&D 2024» viene hecho (la vista de siempre) y no se edita: se duplica y se edita la copia.
 * - Los del usuario se guardan en los ajustes (`statblockPresets`).
 * - Cada statblock usa el general (`statblockPreset`, por id) o el suyo (propiedad `preset`, por nombre:
 *   es lo que se ve en las propiedades). Si el nombre no existe (borrado o renombrado), el general.
 */

/** Las partes del statblock, en el orden de «D&D 2024». Se reordenan todas. */
export const STATBLOCK_ITEMS = [
	"header",
	"defense",
	"speed",
	"abilities",
	"skills",
	"vulnerabilities",
	"resistances",
	"immunities",
	"gear",
	"senses",
	"languages",
	"challenge",
	"traits",
	"spellcasting",
	"actions",
	"bonus_actions",
	"reactions",
	"legendary_actions",
	"lair_actions",
] as const;
export type StatblockItem = (typeof STATBLOCK_ITEMS)[number];

/**
 * Lo que se puede ocultar (decidido el 2026-11-25): tres partes enteras y detalles de otras. `hidden` de un
 * preset solo tiene claves de aquí.
 */
export const HIDEABLE = ["initiative", "pb", "saves", "gear", "senses", "passive_perception", "languages", "cr", "xp", "xp_lair", "legendary_header"] as const;
export type Hideable = (typeof HIDEABLE)[number];

export interface StatblockPreset {
	id: string;
	name: string;
	/** Todas las partes (`STATBLOCK_ITEMS`), en el orden en que se dibujan. */
	order: StatblockItem[];
	hidden: Hideable[];
	columns: 1 | 2;
	/** Velocidad y sentidos también en metros, entre paréntesis («60 ft. (18 m)»). */
	metric: boolean;
}

export const BUILTIN_PRESET_ID = "dnd5e-2024";

export const BUILTIN_PRESET: Readonly<StatblockPreset> = Object.freeze({
	id: BUILTIN_PRESET_ID,
	name: "D&D 2024",
	order: [...STATBLOCK_ITEMS],
	hidden: [],
	columns: 1,
	metric: false,
});

/** Lo que los ajustes necesitan tener para los presets. */
export interface PresetSettings {
	statblockPreset: string;
	statblockPresets: StatblockPreset[];
}

/**
 * Un preset leído de los ajustes, con todas las partes una sola vez: las que falten (p. ej. si se añade
 * una en otra versión) se ponen detrás de la que las precede en el orden de «D&D 2024».
 */
export function normalizePreset(raw: unknown): StatblockPreset | null {
	if (!raw || typeof raw !== "object") return null;
	const p = raw as Partial<StatblockPreset>;
	if (typeof p.id !== "string" || !p.id || p.id === BUILTIN_PRESET_ID) return null;
	const order: StatblockItem[] = [];
	for (const item of Array.isArray(p.order) ? p.order : []) if ((STATBLOCK_ITEMS as readonly unknown[]).includes(item) && !order.includes(item)) order.push(item);
	STATBLOCK_ITEMS.forEach((item, i) => {
		if (order.includes(item)) return;
		const before = i > 0 ? order.indexOf(STATBLOCK_ITEMS[i - 1]) : -1;
		order.splice(before + 1, 0, item);
	});
	return {
		id: p.id,
		name: typeof p.name === "string" && p.name.trim() ? p.name : p.id,
		order,
		hidden: (Array.isArray(p.hidden) ? p.hidden : []).filter((h, i, all): h is Hideable => (HIDEABLE as readonly unknown[]).includes(h) && all.indexOf(h) === i),
		columns: p.columns === 2 ? 2 : 1,
		metric: p.metric === true,
	};
}

/** «D&D 2024» y los del usuario, por este orden. */
export function allPresets(s: PresetSettings): StatblockPreset[] {
	return [BUILTIN_PRESET, ...s.statblockPresets];
}

/** El preset general (el de los ajustes; si ya no existe, «D&D 2024»). */
export function defaultPreset(s: PresetSettings): StatblockPreset {
	return allPresets(s).find((p) => p.id === s.statblockPreset) ?? BUILTIN_PRESET;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** El preset de un statblock: el de su propiedad `preset` (por nombre, sin distinguir mayúsculas) o el general. */
export function presetFor(s: PresetSettings, name: string | undefined): StatblockPreset {
	return (name ? allPresets(s).find((p) => sameName(p.name, name)) : undefined) ?? defaultPreset(s);
}

/** Un nombre que no tenga ningún otro preset: el mismo o con un número («Compacto 2»). */
export function freePresetName(s: PresetSettings, base: string, except?: string): string {
	const taken = (n: string) => allPresets(s).some((p) => p.id !== except && sameName(p.name, n));
	const clean = base.trim() || "Preset";
	if (!taken(clean)) return clean;
	let n = 2;
	while (taken(`${clean} ${n}`)) n++;
	return `${clean} ${n}`;
}

/** Copia de un preset con otro id y nombre (para «Duplicar» y «Nuevo preset»). */
export function copyPreset(s: PresetSettings, from: StatblockPreset, name: string): StatblockPreset {
	let id: string;
	do id = `p${Math.random().toString(36).slice(2, 10)}`;
	while (allPresets(s).some((p) => p.id === id));
	return { id, name: freePresetName(s, name), order: [...from.order], hidden: [...from.hidden], columns: from.columns, metric: from.metric };
}

/** ¿Se muestra? */
export function shows(p: StatblockPreset, what: Hideable): boolean {
	return !p.hidden.includes(what);
}
