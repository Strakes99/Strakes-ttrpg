import { App, TFile } from "obsidian";

/**
 * Los pines guardan su enlace como wikilink: "[[Nota]]", "[[Nota#Encabezado]]",
 * "[[Carpeta/Nota|alias]]". El formato del nombre (más corto posible, relativo o
 * absoluto) sigue el ajuste de Obsidian «Formato de los vínculos nuevos».
 */

export interface ParsedWikilink {
	/** Nombre o ruta de la nota, sin .md (lo que va antes de # y |). */
	linkpath: string;
	/** "#Encabezado" o "#^bloque", o "" si no hay. */
	subpath: string;
	alias: string;
}

export function parseWikilink(text: string): ParsedWikilink {
	let s = text.trim();
	const m = s.match(/^!?\[\[([\s\S]*)\]\]$/);
	if (m) s = m[1];
	let alias = "";
	const bar = s.indexOf("|");
	if (bar >= 0) {
		alias = s.slice(bar + 1).trim();
		s = s.slice(0, bar);
	}
	const hash = s.indexOf("#");
	const linkpath = (hash >= 0 ? s.slice(0, hash) : s).trim();
	const subpath = hash >= 0 ? s.slice(hash).trim() : "";
	return { linkpath, subpath, alias };
}

export function makeWikilink(linkpath: string, subpath = "", alias = ""): string {
	return `[[${linkpath}${subpath}${alias ? `|${alias}` : ""}]]`;
}

/** Texto para openLinkText / vista previa al pasar el ratón ("Nota#Encabezado"). */
export function linktextOf(link: string): string {
	const p = parseWikilink(link);
	return p.linkpath + p.subpath;
}

export function resolveWikilink(app: App, link: string, sourcePath: string): TFile | null {
	const { linkpath } = parseWikilink(link);
	if (!linkpath) return null;
	return (
		app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) ??
		(app.vault.getAbstractFileByPath(linkpath) instanceof TFile ? (app.vault.getAbstractFileByPath(linkpath) as TFile) : null)
	);
}

/** Wikilink hacia un archivo, con el formato de nombre que prefiere Obsidian. */
export function wikilinkFor(app: App, file: TFile, sourcePath: string, subpath = "", alias = ""): string {
	return makeWikilink(app.metadataCache.fileToLinktext(file, sourcePath, true), subpath, alias);
}

/** ¿Este linkpath apuntaba al archivo que estaba en oldPath? */
export function linkpathMatchesPath(linkpath: string, oldPath: string): boolean {
	const lp = linkpath.toLowerCase().replace(/\.md$/, "");
	const old = oldPath.toLowerCase().replace(/\.md$/, "");
	const oldBase = old.split("/").pop() ?? old;
	return lp === old || lp === oldBase || old.endsWith(`/${lp}`);
}
