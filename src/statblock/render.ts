import { App, Component, MarkdownRenderer } from "obsidian";
import { T } from "../i18n";
import { Statblock } from "./data";
import { Boxes, LabelValue, LayoutEntry, StatblockLayout } from "./layout";
import { UseRef } from "./uses";

/** Columnas de un statblock: las suyas (`columns`) o las de los ajustes (`statblockColumns`). */
export function statblockColumns(sb: Statblock, setting: string): 1 | 2 {
	return sb.columns ?? (setting === "2" ? 2 : 1);
}

/**
 * Dibujo de un statblock (1.4) con su maqueta (`layout.ts`), en HTML propio con la disposición de los
 * statblocks oficiales de 2024: nombre en versalitas, tipo en cursiva, etiquetas en negrita, títulos de
 * sección en versalitas y entradas con el nombre en negrita y cursiva. **Sin colores, rayas, tamaños ni
 * fuentes propios:** salen del tema de Obsidian (variables de encabezados y texto). Ver `styles.css`,
 * «Statblocks».
 *
 * Columnas: con una, el statblock ocupa la mitad del ancho disponible; con dos, todo el ancho, repartido
 * en dos columnas. Si el sitio es estrecho (móvil, barra lateral), una sola a todo el ancho (consulta de
 * contenedor en `.strakes-stat-wrap`).
 *
 * Los textos de rasgos y acciones (Markdown) se dibujan con `MarkdownRenderer`, con `component` como dueño.
 */
export async function renderStatblock(
	app: App,
	parent: HTMLElement,
	layout: StatblockLayout,
	sourcePath: string,
	component: Component,
	columns: 1 | 2,
	/** Al marcar o desmarcar una casilla: cuántas quedan gastadas. Sin él, las casillas no se pueden tocar (vista previa del formulario). */
	onUse?: (ref: UseRef, used: number) => void,
	/**
	 * Vista previa del formulario: cada parte lleva `data-sb-target` con el campo del formulario al que
	 * lleva un clic (ver `StatblockEditorView.focusTarget`).
	 */
	targets = false,
): Promise<HTMLElement> {
	const wrap = parent.createDiv("strakes-stat-wrap");
	const sb = wrap.createDiv({ cls: `strakes-statblock is-cols-${columns}` });
	const markdown = (el: HTMLElement, text: string) => MarkdownRenderer.render(app, text, el, sourcePath, component);
	const mark = (el: HTMLElement, target: string | undefined) => {
		if (targets && target) el.setAttr("data-sb-target", target);
		return el;
	};
	const pair = (el: HTMLElement, lv: LabelValue) => {
		mark(el, lv.field);
		el.createSpan({ cls: "strakes-stat-key", text: lv.label });
		el.appendText(` ${lv.value}`);
	};

	// Cabecera: nombre, tipo, bloque superior y características (no se parte entre columnas).
	const head = sb.createDiv("strakes-stat-head");
	mark(head.createDiv({ cls: "strakes-stat-name", text: layout.name }), "name");
	if (layout.subtitle) mark(head.createDiv({ cls: "strakes-stat-subtitle", text: layout.subtitle }), "subtitle");
	if (layout.top.length || layout.speed) {
		const top = head.createDiv("strakes-stat-top");
		for (const row of layout.top)
			for (const c of row) {
				const cell = top.createDiv("strakes-stat-top-cell");
				if (c) pair(cell, c);
			}
		if (layout.speed) pair(top.createDiv("strakes-stat-top-cell is-wide"), { label: T("statblock.speed"), value: layout.speed, field: "speed" });
	}
	if (layout.abilities) {
		const grid = head.createDiv("strakes-stat-abilities");
		const cell = (a: (typeof layout.abilities)[number], o: { cls?: string; text: string }) => mark(grid.createDiv(o), `ability:${a.ability}`);
		for (const a of layout.abilities) cell(a, { cls: "strakes-stat-ability-label", text: a.label });
		grid.createDiv();
		for (const a of layout.abilities) cell(a, { cls: "strakes-stat-ability-score", text: a.score });
		grid.createDiv();
		for (const a of layout.abilities) cell(a, { text: a.mod });
		grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.mod") });
		for (const a of layout.abilities) cell(a, { text: a.save });
		grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.save") });
	}

	// Todas las habilidades: tabla de cuatro columnas, de arriba abajo.
	if (layout.allSkills?.length) {
		const skills = layout.allSkills;
		const grid = mark(sb.createDiv("strakes-stat-all-skills"), "skills");
		const half = Math.ceil(skills.length / 2);
		for (let h = 0; h < 2; h++) {
			grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.skillHeader") });
			grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.mod") });
		}
		for (let i = 0; i < half; i++)
			for (const s of [skills[i], skills[i + half]]) {
				grid.createDiv({ text: s?.label ?? "" });
				grid.createDiv({ text: s?.value ?? "" });
			}
	}

	if (layout.lines.length) {
		const lines = sb.createDiv("strakes-stat-lines");
		for (const l of layout.lines) pair(lines.createDiv("strakes-stat-line"), l);
	}

	const renders: Promise<void>[] = [];
	for (const s of layout.sections) {
		const sec = sb.createDiv("strakes-stat-section");
		const title = mark(sec.createDiv({ cls: "strakes-stat-section-title", text: s.title }), `section:${s.key}`);
		if (s.boxes) title.appendChild(renderBoxes(s.boxes, onUse));
		const introTarget = s.key === "legendary_actions" ? "legendary_header" : s.key === "mythic_actions" ? "mythic_header" : `section:${s.key}`;
		if (s.intro) renders.push(markdown(mark(sec.createDiv("strakes-stat-entry"), introTarget), s.intro));
		for (const e of s.entries) renders.push(renderEntry(mark(sec.createDiv("strakes-stat-entry"), e.target), e, markdown, onUse, mark));
	}
	await Promise.all(renders);
	return wrap;
}

/**
 * Una entrada: su Markdown y, detrás del nombre (el primer `strong`/`em` del primer párrafo), sus
 * casillas. Los bloques de conjuros añaden la CD, las listas (con sus casillas) y el texto final.
 */
async function renderEntry(
	el: HTMLElement,
	e: LayoutEntry,
	markdown: (el: HTMLElement, text: string) => Promise<void>,
	onUse: ((ref: UseRef, used: number) => void) | undefined,
	mark: (el: HTMLElement, target: string | undefined) => HTMLElement,
): Promise<void> {
	const body = el.createDiv();
	await markdown(body, e.markdown);
	if (e.boxes) {
		const title = body.querySelector("p")?.firstElementChild;
		const boxes = renderBoxes(e.boxes, onUse);
		if (title && (title.tagName === "STRONG" || title.tagName === "EM")) title.after(boxes);
		else body.prepend(boxes);
	}
	if (!e.spell) return;
	if (e.spell.stats) {
		const stats = mark(el.createDiv("strakes-stat-top strakes-stat-spell-stats"), `${e.target}:stats`);
		for (const s of e.spell.stats) {
			const cell = stats.createDiv("strakes-stat-top-cell");
			cell.createSpan({ cls: "strakes-stat-key", text: s.label });
			cell.appendText(` ${s.value}`);
		}
	}
	for (const line of e.spell.lines) {
		const row = mark(el.createDiv("strakes-stat-spell-line"), line.target);
		row.createEl("strong", { text: `${line.label}:` });
		if (line.boxes) row.appendChild(renderBoxes(line.boxes, onUse));
		row.appendText(" ");
		line.spells.forEach((s, i) => {
			if (i) row.appendText(", ");
			row.createEl("em", { text: s.name });
			if (s.boxes) row.appendChild(renderBoxes(s.boxes, onUse));
		});
	}
	if (e.spell.footer) await markdown(mark(el.createDiv(), `${e.target}:footer`), e.spell.footer);
}

/**
 * Casillas: marcar la n.ª deja gastadas las n primeras; desmarcarla, las anteriores. Se actualizan al
 * momento y `onUse` guarda (la nota cambia y el statblock se vuelve a dibujar). En Live Preview se para
 * el clic, para no entrar a editar el bloque.
 */
function renderBoxes(boxes: Boxes, onUse?: (ref: UseRef, used: number) => void): HTMLElement {
	const span = createSpan("strakes-stat-boxes");
	const inputs: HTMLInputElement[] = [];
	for (let i = 0; i < boxes.total; i++) {
		const cb = span.createEl("input", { type: "checkbox", cls: "strakes-stat-box" });
		cb.checked = i < boxes.used;
		if (boxes.lairFrom !== undefined && i >= boxes.lairFrom) {
			cb.addClass("is-lair");
			cb.setAttr("aria-label", T("statblock.lairOnly"));
		}
		if (boxes.recharge) cb.setAttr("aria-label", T("statblock.rechargeSpent"));
		if (!onUse) cb.disabled = true;
		cb.addEventListener("mousedown", (ev) => ev.stopPropagation());
		cb.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const used = cb.checked ? i + 1 : i;
			inputs.forEach((x, j) => (x.checked = j < used));
			onUse?.(boxes.ref, used);
		});
		inputs.push(cb);
	}
	return span;
}
