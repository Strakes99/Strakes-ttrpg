import { Notice, TFile } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { promptText } from "../ui/modals";
import { isStatblock, nameFromNote } from "./data";
import { createStatblockNote, draftFromFrontmatter } from "./notes";
import { openStatblockEditor } from "./StatblockEditorView";

/**
 * Acciones de los statblocks (1.4) que usan el comando, el menú de carpeta y los botones del statblock
 * dibujado: crear, editar y copiar a una nota nueva.
 */

/** Pide el nombre de la criatura, crea la nota (en `folder` o en la carpeta de los ajustes) y abre el formulario. */
export async function newStatblock(plugin: StrakesTTRPG, folder?: string): Promise<void> {
	const name = await promptText(plugin.app, T("sbForm.newTitle"), { placeholder: T("sbForm.newPlaceholder"), description: T("sbForm.newDesc") });
	if (!name?.trim()) return;
	const file = await createStatblockNote(plugin, name.trim(), {}, folder);
	await openStatblockEditor(plugin, file);
}

/** Las propiedades de una nota, si es de statblock. */
export function statblockFrontmatter(plugin: StrakesTTRPG, file: TFile | null): Record<string, unknown> | null {
	if (!file || file.extension !== "md") return null;
	const fm: unknown = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	return isStatblock(fm) ? (fm as Record<string, unknown>) : null;
}

/** «Copiar a nuevo statblock»: una nota nueva con los mismos datos, en la carpeta de los ajustes, abierta en el formulario. */
export async function copyStatblock(plugin: StrakesTTRPG, file: TFile): Promise<void> {
	const fm = statblockFrontmatter(plugin, file);
	if (!fm) return;
	const draft = draftFromFrontmatter(fm);
	const s = plugin.settings;
	const name = typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : nameFromNote(file.basename, s.statblockPrefix, s.statblockSuffix);
	const copy = await createStatblockNote(plugin, name, draft);
	new Notice(T("sbForm.copied", { name: copy.basename }));
	await openStatblockEditor(plugin, copy);
}
