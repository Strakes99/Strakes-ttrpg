import { Keymap } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { showLinkPopover } from "./linkPopover";
import { findCondition } from "./linkResolve";
import { hasLinkTag, LinkTag, splitLinkTags } from "./linkTags";

/**
 * Enlaces en lo ya dibujado (1.4, paso 6): convierte las marcas `{@condition …}`, `{@creature …}` y
 * `{@spell …}` de un elemento en enlaces. Lo usan el posprocesador de Markdown (modo lectura, notas
 * incrustadas, vistas previas, y todo lo que dibuja `MarkdownRenderer`), el statblock dibujado, las fichas
 * de condición y Live Preview (con `createLinkEl`).
 *  - Condición y criatura: con Ctrl/Cmd y el ratón encima, su ventanita (`linkPopover.ts`). Clic: la ficha
 *    de la condición (fijada) o la nota de la criatura (Ctrl/Cmd+clic, en otra pestaña, como en Obsidian).
 *  - Si no se encuentra, se ve atenuada y no hace nada.
 *  - Conjuro: hasta la 1.6 (hechizos), solo su nombre en cursiva.
 */

/**
 * Los ayudantes de Obsidian (`createEl`, `createSpan`, `createFragment`) de la ventana del documento: cada
 * ventana emergente tiene los suyos, y así el elemento nace en su documento. La revisión de la tienda pide
 * estos ayudantes en lugar de `document.createElement` (aviso `prefer-create-el`, 1.4.0 a 1.4.2).
 */
function helpers(doc: Document): Window & typeof globalThis {
	const win = doc.defaultView;
	return win && typeof win.createEl === "function" ? win : window;
}

/** Elemento de un enlace. */
export function createLinkEl(plugin: StrakesTTRPG, tag: LinkTag, doc: Document = activeDocument): HTMLElement {
	if (tag.kind === "spell") return helpers(doc).createEl("em", { cls: "strakes-link-spell", text: tag.display });
	const el = helpers(doc).createSpan({ cls: ["strakes-link", `is-${tag.kind}`], text: tag.display });
	const found = tag.kind === "condition" ? !!findCondition(tag.name, plugin.settings) : !!plugin.creatures.find(tag.name, tag.source);
	if (!found) {
		el.addClass("is-unresolved");
		el.setAttr("aria-label", T("links.notFound", { name: tag.name }));
		return el;
	}
	// Ctrl/Cmd con el ratón encima (o al pulsarlo con el ratón ya encima): la ventanita.
	let over = false;
	const onKey = (e: KeyboardEvent) => {
		if (over && (e.key === "Control" || e.key === "Meta")) showLinkPopover(plugin, el, tag, false);
	};
	el.addEventListener("mouseenter", (e) => {
		over = true;
		el.doc.addEventListener("keydown", onKey);
		if (Keymap.isModifier(e, "Mod")) showLinkPopover(plugin, el, tag, false);
	});
	el.addEventListener("mouseleave", () => {
		over = false;
		el.doc.removeEventListener("keydown", onKey);
	});
	// En Live Preview y en un bloque de código dibujado, un clic entraría a editar: se para.
	el.addEventListener("mousedown", (e) => e.stopPropagation());
	el.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (tag.kind === "condition") showLinkPopover(plugin, el, tag, true);
		else {
			const file = plugin.creatures.find(tag.name, tag.source);
			if (file) void plugin.app.workspace.getLeaf(Keymap.isModEvent(e) || false).openFile(file);
		}
	});
	return el;
}

/** Elementos donde no se buscan marcas (código, campos, enlaces ya hechos). */
const SKIP = "code, pre, a, input, textarea, .strakes-link, .strakes-link-spell, .cm-editor";

/** Convierte las marcas de enlace de los textos de un elemento. */
export function linkifyElement(plugin: StrakesTTRPG, root: HTMLElement): void {
	const doc = root.doc;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const text = n as Text;
		if (!hasLinkTag(text.data)) continue;
		if (text.parentElement?.closest(SKIP)) continue;
		nodes.push(text);
	}
	for (const text of nodes) {
		const frag = helpers(doc).createFragment();
		for (const part of splitLinkTags(text.data)) {
			if (typeof part === "string") frag.appendText(part);
			else frag.appendChild(createLinkEl(plugin, part, doc));
		}
		text.replaceWith(frag);
	}
}
