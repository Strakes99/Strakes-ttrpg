import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { ensureFolder, freeNotePath } from "./notes";

/**
 * «Base de bestiario» (1.4, paso 8; decidido el 2026-11-25): un archivo `.base` de Obsidian con una tabla de
 * todas las notas de statblock (las que tienen la propiedad `statblock`, estén en la carpeta que estén).
 *
 * - Columnas: nombre (la nota), VD, VD como número, tipo, tamaño, alineamiento, hábitat y fuente.
 * - El VD se guarda como texto («1/2», «10»): ordenado como texto, «10» iría antes que «2». La fórmula
 *   `cr_number` lo pasa a número («1/2» → 0,5) y la tabla se ordena por ella.
 * - Los valores salen como están en las propiedades (en inglés: «medium», «beast»): las Bases no pueden
 *   traducirlos. Los nombres de las columnas, en el idioma de la interfaz al crearla.
 * - Sintaxis comprobada con la ayuda de Obsidian (Bases, «Syntax» y «Functions») y con las Bases que el
 *   propio Obsidian guarda (`sort` con `property` y `direction`).
 */
export function bestiaryBaseYaml(): string {
	const q = (s: string) => JSON.stringify(s);
	const columns: [string, string][] = [
		["file.name", T("bestiary.name")],
		["note.cr", T("bestiary.cr")],
		["formula.cr_number", T("bestiary.crNumber")],
		["note.type", T("bestiary.type")],
		["note.size", T("bestiary.size")],
		["note.alignment", T("bestiary.alignment")],
		["note.habitat", T("bestiary.habitat")],
		["note.source", T("bestiary.source")],
	];
	const cr = 'cr.toString()';
	const formula = `if(cr, if(${cr}.contains("/"), number(${cr}.split("/")[0]) / number(${cr}.split("/")[1]), number(cr)))`;
	return [
		"filters:",
		"  and:",
		'    - file.hasProperty("statblock")',
		"formulas:",
		`  cr_number: '${formula}'`,
		"properties:",
		...columns.flatMap(([key, name]) => [`  ${key}:`, `    displayName: ${q(name)}`]),
		"views:",
		"  - type: table",
		`    name: ${q(T("bestiary.fileName"))}`,
		"    order:",
		...columns.map(([key]) => `      - ${key.replace(/^note\./, "")}`),
		"    sort:",
		"      - property: formula.cr_number",
		"        direction: ASC",
		"      - property: file.name",
		"        direction: ASC",
		"",
	].join("\n");
}

/** Botón de los ajustes: crea la Base en la carpeta de statblocks (sin sobrescribir: «Bestiario 2») y la abre. */
export async function createBestiaryBase(plugin: StrakesTTRPG): Promise<void> {
	const folder = await ensureFolder(plugin, plugin.settings.statblockFolder);
	const path = freeNotePath(plugin, folder, T("bestiary.fileName"), "base");
	const file = await plugin.app.vault.create(path, bestiaryBaseYaml());
	await plugin.app.workspace.getLeaf("tab").openFile(file);
}
