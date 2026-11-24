import { normalizePath, TFile, TFolder } from "obsidian";
import type StrakesTTRPG from "../main";
import { STATBLOCK_BLOCK } from "./data";

/** Valor de `statblock` de las notas nuevas. */
export const DEFAULT_SYSTEM = "dnd5e-2024";

/**
 * Propiedades de un statblock, en el orden en que se escriben en la nota (el del statblock dibujado).
 * Al guardar, el formulario reescribe estas claves en este orden y deja detrás las demás propiedades
 * de la nota (etiquetas, alias…), sin tocarlas.
 */
export const STATBLOCK_KEYS = [
	"statblock",
	"name",
	"short_name",
	"named",
	"size",
	"type",
	"subtype",
	"swarm_creature_size",
	"alignment",
	"ac",
	"ac_note",
	"initiative_proficiency",
	"initiative",
	"hp",
	"hp_formula",
	"speed",
	"hover",
	"cr",
	"xp",
	"pb",
	"lair",
	"xp_lair",
	"str",
	"dex",
	"con",
	"int",
	"wis",
	"cha",
	"save_proficiencies",
	"saves",
	"skill_proficiencies",
	"skills",
	"all_skills",
	"vulnerabilities",
	"resistances",
	"immunities",
	"condition_immunities",
	"gear",
	"senses",
	"senses_other",
	"passive_perception",
	"languages",
	"traits",
	"spellcasting",
	"actions",
	"bonus_actions",
	"reactions",
	"legendary_uses",
	"legendary_uses_lair",
	"legendary_header",
	"legendary_actions",
	"mythic_header",
	"mythic_actions",
	"source",
	"page",
	"habitat",
	"treasure",
] as const;

export type Draft = Record<string, unknown>;

/**
 * Quita lo vacío de un valor del borrador, para no escribir propiedades sin nada: textos vacíos,
 * `false`, listas y objetos vacíos, y entradas de listas sin contenido. Devuelve `undefined` si no
 * queda nada.
 */
export function cleanValue(v: unknown): unknown {
	if (v === null || v === undefined || v === false || v === "") return undefined;
	if (typeof v === "string") return v.trim() === "" ? undefined : v;
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (Array.isArray(v)) {
		const items = v.map(cleanValue).filter((x) => x !== undefined);
		return items.length ? items : undefined;
	}
	if (typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
			const c = cleanValue(x);
			if (c !== undefined) out[k] = c;
		}
		return Object.keys(out).length ? out : undefined;
	}
	return v;
}

/** Las propiedades de statblock del borrador, limpias y en el orden de `STATBLOCK_KEYS`. */
export function cleanDraft(draft: Draft): Draft {
	const out: Draft = {};
	for (const k of STATBLOCK_KEYS) {
		let v = cleanValue(draft[k]);
		if (k === "initiative_proficiency" && v === "none") v = undefined;
		if (v !== undefined) out[k] = v;
	}
	return out;
}

/** Las propiedades de statblock de una nota (copia, para editarla sin tocar la caché de Obsidian). */
export function draftFromFrontmatter(fm: Record<string, unknown> | undefined): Draft {
	const out: Draft = {};
	if (!fm) return out;
	for (const k of STATBLOCK_KEYS) if (fm[k] !== undefined) out[k] = structuredClone(fm[k]);
	return out;
}

/** Escribe el borrador en las propiedades de la nota: las de statblock en su orden y, detrás, las demás. */
export async function writeDraft(plugin: StrakesTTRPG, file: TFile, draft: Draft): Promise<void> {
	const clean = cleanDraft(draft);
	await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const others: [string, unknown][] = Object.entries(fm).filter(([k]) => !(STATBLOCK_KEYS as readonly string[]).includes(k));
		for (const k of Object.keys(fm)) delete fm[k];
		Object.assign(fm, clean);
		for (const [k, v] of others) fm[k] = v;
	});
}

/** Carpeta de las notas nuevas: la de los ajustes («Statblocks»), creada si no existe. */
async function ensureFolder(plugin: StrakesTTRPG, folder: string): Promise<string> {
	const path = normalizePath(folder.trim() || "/");
	if (path === "/" || path === "") return "";
	if (!(plugin.app.vault.getAbstractFileByPath(path) instanceof TFolder)) await plugin.app.vault.createFolder(path);
	return path;
}

/** Ruta libre para una nota: si ya existe, añade un número («ST-Goblin 2»). Nunca se sobrescribe nada. */
export function freeNotePath(plugin: StrakesTTRPG, folder: string, base: string): string {
	const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Statblock";
	const at = (name: string) => normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	let path = at(clean);
	for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) path = at(`${clean} ${n}`);
	return path;
}

/**
 * Crea una nota de statblock con estos datos y el bloque que la dibuja. `folder` vacío = la carpeta de
 * los ajustes. El nombre de la nota lleva el prefijo y el sufijo de los ajustes.
 */
export async function createStatblockNote(plugin: StrakesTTRPG, name: string, data: Draft, folder?: string): Promise<TFile> {
	const s = plugin.settings;
	const dir = await ensureFolder(plugin, folder ?? s.statblockFolder);
	const path = freeNotePath(plugin, dir, `${s.statblockPrefix}${name}${s.statblockSuffix}`);
	const file = await plugin.app.vault.create(path, `\`\`\`${STATBLOCK_BLOCK}\n\`\`\`\n`);
	await writeDraft(plugin, file, { statblock: DEFAULT_SYSTEM, ...data, name });
	return file;
}
