import { TFile } from "obsidian";
import { translationsOf } from "../i18n";
import { allConditions, ConditionCatalog, ConditionInfo } from "../initiative/conditions";
import type StrakesTTRPG from "../main";
import { isStatblock, nameFromNote } from "../statblock/data";
import { normalizeName } from "./linkTags";

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
 */
export class CreatureIndex {
	private map: Map<string, TFile> | null = null;

	constructor(private plugin: StrakesTTRPG) {}

	invalidate(): void {
		this.map = null;
	}

	find(name: string): TFile | null {
		if (!this.map) this.map = this.build();
		return this.map.get(normalizeName(name)) ?? null;
	}

	private build(): Map<string, TFile> {
		const { app, settings } = this.plugin;
		const byNote = new Map<string, TFile>();
		const byName = new Map<string, TFile>();
		const files = app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
		for (const file of files) {
			const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!isStatblock(fm)) continue;
			for (const n of [nameFromNote(file.basename, settings.statblockPrefix, settings.statblockSuffix), file.basename].map(normalizeName))
				if (n && !byNote.has(n)) byNote.set(n, file);
			const own = (fm as { name?: unknown }).name;
			const n = typeof own === "string" ? normalizeName(own) : "";
			if (n && !byName.has(n)) byName.set(n, file);
		}
		// El nombre de la nota manda: lo que solo coincide por `name` se añade si no está ya.
		for (const [n, file] of byName) if (!byNote.has(n)) byNote.set(n, file);
		return byNote;
	}
}
