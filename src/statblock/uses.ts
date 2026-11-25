import { App, MarkdownView, TFile } from "obsidian";
import { ENTRY_SECTIONS, EntrySection, STATBLOCK_BLOCK, Statblock } from "./data";

/**
 * Casillas de usos de los statblocks (1.4, paso 4): usos al día o por descanso, recargas (una casilla:
 * «gastada»), listas de conjuros al día, espacios de conjuro, bloques de conjuros con usos propios y usos
 * de acción legendaria.
 *
 * **Lo gastado se guarda como texto dentro del bloque ` ```strakes-statblock``` ` de la nota**, no en sus
 * propiedades (decisión del desarrollador, 2026-11-24, como las casillas de ITS, que solo son texto de la
 * nota): una línea por casilla con algo gastado, `clave: n`, y el bloque vacío si no hay nada. Así las
 * propiedades (y las Bases) solo tienen la criatura. En la 1.5, cada combatiente del tracker llevará el suyo.
 *
 * Claves (\`useKey\`): `legendary`, `traits.3` (sección e índice de la entrada en la nota), `spellcasting.0`
 * (el bloque), `spellcasting.0.per_day.1` (una lista al día; en «cada uno», `…per_day.1/Fireball`) y
 * `spellcasting.0.levels.2` (un nivel).
 *
 * Los índices son posiciones en las listas de la nota: al mover o quitar algo en el formulario,
 * `remapUsed` cambia las claves para que lo gastado siga a su entrada (deshacer y rehacer no lo hacen).
 */

/** Dónde está una casilla (para su clave). */
export type UseRef =
	| { kind: "legendary" }
	| { kind: "block"; block: number }
	| { kind: "entry"; section: EntrySection; index: number }
	| { kind: "perDay"; block: number; index: number; spell?: string }
	| { kind: "level"; block: number; index: number };

export function useKey(ref: UseRef): string {
	switch (ref.kind) {
		case "legendary":
			return "legendary";
		case "entry":
			return `${ref.section}.${ref.index}`;
		case "block":
			return `spellcasting.${ref.block}`;
		case "perDay":
			return `spellcasting.${ref.block}.per_day.${ref.index}${ref.spell !== undefined ? `/${ref.spell}` : ""}`;
		case "level":
			return `spellcasting.${ref.block}.levels.${ref.index}`;
	}
}

/** Lo gastado escrito en el bloque: `clave: n` por línea (lo que no tenga esa forma se ignora). */
export function parseUsed(body: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const line of body.split("\n")) {
		const i = line.lastIndexOf(":");
		if (i <= 0) continue;
		const n = Number(line.slice(i + 1).trim());
		if (Number.isInteger(n) && n > 0) out.set(line.slice(0, i).trim(), n);
	}
	return out;
}

export function serializeUsed(used: Map<string, number>): string {
	return [...used]
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${k}: ${n}`)
		.join("\n");
}

/** Qué pasa con cada índice de una lista al moverla o quitar algo: el índice nuevo, o `null` si se quitó. */
export type IndexMove = (index: number) => number | null;

/** Mover el elemento `i` a `to` (una posición arriba o abajo: los dos se intercambian). */
export function swapMove(i: number, to: number): IndexMove {
	return (x) => (x === i ? to : x === to ? i : x);
}

/** Quitar el elemento `i`: los de detrás suben una posición. */
export function removeMove(i: number): IndexMove {
	return (x) => (x === i ? null : x > i ? x - 1 : x);
}

/**
 * Las claves de lo gastado tras mover o quitar algo en la lista `list` (`traits`, `spellcasting`,
 * `spellcasting.0.per_day`…): cambia el índice que va justo detrás de `list.` (y con él lo que cuelga de
 * ese elemento, p. ej. `spellcasting.1.levels.2` al mover el bloque 1) y quita lo del elemento quitado.
 */
export function remapListKeys(used: Map<string, number>, list: string, move: IndexMove): Map<string, number> {
	const re = new RegExp(`^${list.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)(?=$|[./])`);
	const out = new Map<string, number>();
	for (const [key, n] of used) {
		const m = re.exec(key);
		if (!m) {
			out.set(key, n);
			continue;
		}
		const to = move(Number(m[1]));
		if (to !== null) out.set(`${list}.${to}${key.slice(m[0].length)}`, n);
	}
	return out;
}

/** Pone en el statblock leído de las propiedades lo gastado del bloque. */
export function applyUsed(sb: Statblock, used: Map<string, number>): void {
	sb.legendary_used = used.get("legendary") ?? 0;
	for (const s of ENTRY_SECTIONS) for (const e of sb.entries[s]) e.used = used.get(useKey({ kind: "entry", section: s, index: e.index })) ?? 0;
	for (const b of sb.spellcasting) {
		b.used = used.get(useKey({ kind: "block", block: b.index })) ?? 0;
		for (const p of b.per_day) {
			const key = useKey({ kind: "perDay", block: b.index, index: p.index });
			p.used = used.get(key) ?? 0;
			p.usedEach = {};
			for (const [k, n] of used) if (k.startsWith(`${key}/`)) p.usedEach[k.slice(key.length + 1)] = n;
		}
		for (const l of b.levels) l.used = used.get(useKey({ kind: "level", block: b.index, index: l.index })) ?? 0;
	}
}

/** El primer bloque ` ```strakes-statblock``` ` de un texto: líneas de apertura y cierre y su contenido. */
export function findStatblockBlock(text: string): { open: number; close: number; body: string } | null {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = new RegExp(`^\\s*(\`{3,}|~{3,})\\s*${STATBLOCK_BLOCK}\\s*$`).exec(lines[i]);
		if (!m) continue;
		const fence = m[1];
		for (let j = i + 1; j < lines.length; j++) {
			const c = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j]);
			if (c && c[1][0] === fence[0] && c[1].length >= fence.length) return { open: i, close: j, body: lines.slice(i + 1, j).join("\n") };
		}
		return null;
	}
	return null;
}

/** El texto de la nota con el contenido de su bloque cambiado (o el mismo, si no tiene bloque). */
export function withBlockBody(text: string, change: (body: string) => string): string {
	const block = findStatblockBlock(text);
	if (!block) return text;
	const lines = text.split("\n");
	const body = change(block.body);
	lines.splice(block.open + 1, block.close - block.open - 1, ...(body ? body.split("\n") : []));
	return lines.join("\n");
}

/** Lo gastado de una nota (de su bloque). */
export async function readUsed(app: App, file: TFile): Promise<Map<string, number>> {
	return parseUsed(findStatblockBlock(await app.vault.cachedRead(file))?.body ?? "");
}

/**
 * Cambia el contenido del bloque de una nota. Si la nota está abierta en una pestaña, a través de su
 * editor (solo las líneas del bloque): así Obsidian no la recarga como si la hubieran cambiado por fuera,
 * que la devolvía al principio. Si no, con `vault.process`.
 */
async function changeBlock(app: App, file: TFile, change: (body: string) => string): Promise<void> {
	const view = app.workspace
		.getLeavesOfType("markdown")
		.map((l) => l.view)
		.find((v): v is MarkdownView => v instanceof MarkdownView && v.file === file);
	if (view) {
		const editor = view.editor;
		const block = findStatblockBlock(editor.getValue());
		if (!block) return;
		const body = change(block.body);
		if (body === block.body) return;
		editor.replaceRange(body ? `${body}\n` : "", { line: block.open + 1, ch: 0 }, { line: block.close, ch: 0 });
		// Al disco ya: el formulario escribe las propiedades justo después y eso lee el archivo.
		await view.save();
		return;
	}
	await app.vault.process(file, (text) => withBlockBody(text, change));
}

/** Lo gastado de la nota tras mover o quitar algo en una de sus listas (ver `remapListKeys`). */
export async function remapUsed(app: App, file: TFile, list: string, move: IndexMove): Promise<void> {
	await changeBlock(app, file, (body) => serializeUsed(remapListKeys(parseUsed(body), list, move)));
}

export async function setUsed(app: App, file: TFile, ref: UseRef, used: number): Promise<void> {
	await changeBlock(app, file, (body) => {
		const map = parseUsed(body);
		const key = useKey(ref);
		if (used > 0) map.set(key, Math.round(used));
		else map.delete(key);
		return serializeUsed(map);
	});
}

/** «Restablecer usos»: vacía el bloque. */
export async function resetUses(app: App, file: TFile): Promise<void> {
	await changeBlock(app, file, () => "");
}
