import { App, TFile } from "obsidian";
import { ENTRY_SECTIONS, EntrySection } from "./data";

/**
 * Casillas de usos de los statblocks (1.4, paso 4): usos al día o por descanso, recargas (una casilla:
 * «gastada»), listas de conjuros al día, espacios de conjuro y usos de acción legendaria (en la propiedad
 * suelta `legendary_used`). Lo gastado se guarda en las propiedades de
 * la nota, en `used` de cada entrada, lista o nivel (en una lista «cada uno», un objeto por conjuro:
 * `used: { Fireball: 1 }`). Sin nada gastado, no hay `used`.
 */

/** Dónde está una casilla en las propiedades de la nota. */
export type UseRef =
	| { kind: "legendary" }
	| { kind: "block"; block: number }
	| { kind: "entry"; section: EntrySection; index: number }
	| { kind: "perDay"; block: number; index: number; spell?: string }
	| { kind: "level"; block: number; index: number };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Las listas `per_day` o `levels` de un bloque de conjuros (un objeto suelto cuenta como lista de uno). */
function spellList(block: Obj, key: "per_day" | "levels"): unknown[] {
	const raw = block[key];
	return Array.isArray(raw) ? raw : isObj(raw) ? [raw] : [];
}

/** El objeto de las propiedades al que pertenece la casilla, o undefined si ya no existe. */
function target(fm: Obj, ref: Exclude<UseRef, { kind: "legendary" }>): Obj | undefined {
	if (ref.kind === "entry") {
		const list = fm[ref.section];
		const e: unknown = Array.isArray(list) ? list[ref.index] : undefined;
		return isObj(e) ? e : undefined;
	}
	const blocks = fm.spellcasting;
	const block: unknown = Array.isArray(blocks) ? blocks[ref.block] : undefined;
	if (!isObj(block)) return undefined;
	if (ref.kind === "block") return block;
	const item = spellList(block, ref.kind === "perDay" ? "per_day" : "levels")[ref.index];
	return isObj(item) ? item : undefined;
}

/** Pone en `fm` cuántas casillas hay gastadas (0 = quita `used`). Devuelve false si la casilla ya no existe. */
export function setUsedIn(fm: Obj, ref: UseRef, used: number): boolean {
	// Usos de acción legendaria: propiedad suelta `legendary_used`.
	if (ref.kind === "legendary") {
		const n = Math.max(0, Math.round(used));
		if (n > 0) fm.legendary_used = n;
		else delete fm.legendary_used;
		return true;
	}
	const t = target(fm, ref);
	if (!t) return false;
	const n = Math.max(0, Math.round(used));
	if (ref.kind === "perDay" && ref.spell !== undefined) {
		const each: Obj = isObj(t.used) ? { ...t.used } : {};
		if (n > 0) each[ref.spell] = n;
		else delete each[ref.spell];
		if (Object.keys(each).length) t.used = each;
		else delete t.used;
	} else if (n > 0) t.used = n;
	else delete t.used;
	return true;
}

/** «Restablecer usos»: quita todo lo gastado de `fm`. Devuelve true si había algo. */
export function resetUsesIn(fm: Obj): boolean {
	let changed = "legendary_used" in fm;
	delete fm.legendary_used;
	const clear = (o: unknown) => {
		if (isObj(o) && "used" in o) {
			delete o.used;
			changed = true;
		}
	};
	for (const s of ENTRY_SECTIONS) {
		const list = fm[s];
		if (Array.isArray(list)) list.forEach(clear);
	}
	const blocks = fm.spellcasting;
	if (Array.isArray(blocks))
		for (const b of blocks) {
			if (!isObj(b)) continue;
			clear(b);
			spellList(b, "per_day").forEach(clear);
			spellList(b, "levels").forEach(clear);
		}
	return changed;
}

export async function setUsed(app: App, file: TFile, ref: UseRef, used: number): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Obj) => void setUsedIn(fm, ref, used));
}

export async function resetUses(app: App, file: TFile): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Obj) => void resetUsesIn(fm));
}
