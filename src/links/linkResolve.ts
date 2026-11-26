import { TFile } from "obsidian";
import { translationsOf } from "../i18n";
import { allConditions, ConditionCatalog, ConditionInfo } from "../initiative/conditions";
import type StrakesTTRPG from "../main";
import { isStatblock, nameFromNote } from "../statblock/data";
import { normalizeName } from "./linkTags";
import { bookLabel } from "../statblock/import5e";

/**
 * A qué apunta un enlace (1.4, paso 6). Los nombres se comparan sin mayúsculas ni acentos, en cualquier
 * idioma (§12: «el enlace funciona con el nombre en inglés o en español»).
 */

/**
 * La condición de un enlace: por su id, su nombre actual (también el cambiado por el usuario o el de una
 * personalizada) o el nombre de una integrada en cualquier idioma («Grappled», «Agarrado»). Las ocultas
 * también: un enlace a una sigue mostrando su ficha.
 */
export function findCondition(name: string, catalog: ConditionCatalog): ConditionInfo | null {
	const n = normalizeName(name);
	for (const info of allConditions(catalog, { includeHidden: true })) {
		const names = [info.id, info.name, ...(info.custom ? [] : translationsOf(`srd.condition.${info.id}.name`))];
		if (names.some((x) => normalizeName(x) === n)) return info;
	}
	return null;
}

/**
 * Índice de las notas de statblock por nombre. Se rehace la próxima vez que se consulta tras cualquier
 * cambio (lo invalida `main.ts` con los eventos de la bóveda y de la caché de propiedades).
 *
 * Con varias notas para un mismo nombre (el Aboleth de 2014 y el de 2024 tienen el mismo `name`), manda el
 * **nombre de la nota** (sin el prefijo ni el sufijo, o tal cual) sobre la propiedad `name` (decisión del
 * desarrollador, 2026-11-24): `{@creature Aboleth}` → «ST-Aboleth»; `{@creature Aboleth (MM'24)}` → la otra.
 * Entre iguales, la primera por orden alfabético de la ruta, para que no cambie de un día a otro.
 *
 * **Con libro** (`{@creature Aboleth||MM}`, decidido el 2026-11-26): entre las notas con ese nombre, la que
 * tiene ese libro en `source` (ver `creatureLookup`).
 */
export class CreatureIndex {
	private lookup: ((name: string, source?: string) => TFile | null) | null = null;

	constructor(private plugin: StrakesTTRPG) {}

	invalidate(): void {
		this.lookup = null;
	}

	/** La nota de una criatura por su nombre y, si el enlace lo da, su libro. */
	find(name: string, source?: string): TFile | null {
		if (!this.lookup) this.lookup = this.build();
		return this.lookup(name, source);
	}

	private build(): (name: string, source?: string) => TFile | null {
		const { app, settings } = this.plugin;
		const notes: CreatureNote<TFile>[] = [];
		for (const file of app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))) {
			const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!isStatblock(fm)) continue;
			const { name, source } = fm as { name?: unknown; source?: unknown };
			notes.push({
				file,
				noteNames: [nameFromNote(file.basename, settings.statblockPrefix, settings.statblockSuffix), file.basename],
				name: typeof name === "string" ? name : "",
				source: typeof source === "string" ? source : "",
			});
		}
		return creatureLookup(notes);
	}
}

/** Una nota de statblock para buscarla (`F`: su archivo; en los tests, cualquier cosa). */
export interface CreatureNote<F> {
	file: F;
	/** El nombre de la nota sin prefijo ni sufijo, y tal cual. */
	noteNames: string[];
	/** Su propiedad `name`. */
	name: string;
	/** Su propiedad `source` (el libro: «MM», «XMM»…). */
	source: string;
}

/**
 * ¿Es de ese libro? Sin distinguir mayúsculas, por su código («MM») o por la etiqueta con la que el plugin
 * lo pone en los nombres de las notas («MM'14», `bookLabel`).
 */
export function sourceMatches(noteSource: string, wanted: string): boolean {
	const s = noteSource.trim();
	const w = wanted.trim().toUpperCase();
	return !!s && !!w && (s.toUpperCase() === w || bookLabel(s).toUpperCase() === w);
}

/**
 * Búsqueda de criaturas (en orden: las primeras ganan los empates). Sin libro: manda el nombre de la nota
 * sobre la propiedad `name`. Con libro: entre todas las notas con ese nombre (de la nota o `name`), la
 * primera de ese libro; si ninguna lo es, como sin libro.
 */
export function creatureLookup<F>(notes: CreatureNote<F>[]): (name: string, source?: string) => F | null {
	const byNote = new Map<string, F>();
	const byName = new Map<string, F>();
	const candidates = new Map<string, CreatureNote<F>[]>();
	for (const note of notes) {
		const keys = new Set<string>();
		for (const n of note.noteNames.map(normalizeName)) {
			if (!n) continue;
			keys.add(n);
			if (!byNote.has(n)) byNote.set(n, note.file);
		}
		const own = normalizeName(note.name);
		if (own) {
			keys.add(own);
			if (!byName.has(own)) byName.set(own, note.file);
		}
		for (const k of keys) candidates.set(k, [...(candidates.get(k) ?? []), note]);
	}
	// El nombre de la nota manda: lo que solo coincide por `name` se añade si no está ya.
	for (const [n, file] of byName) if (!byNote.has(n)) byNote.set(n, file);
	return (name, source) => {
		const key = normalizeName(name);
		if (source) {
			const hit = candidates.get(key)?.find((note) => sourceMatches(note.source, source));
			if (hit) return hit.file;
		}
		return byNote.get(key) ?? null;
	};
}
