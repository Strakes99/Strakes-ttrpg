import { App, Component, MarkdownRenderer } from "obsidian";
import { T } from "../i18n";
import { Statblock } from "./data";
import { LabelValue, StatblockLayout } from "./layout";

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
): Promise<HTMLElement> {
	const wrap = parent.createDiv("strakes-stat-wrap");
	const sb = wrap.createDiv({ cls: `strakes-statblock is-cols-${columns}` });
	const markdown = (el: HTMLElement, text: string) => MarkdownRenderer.render(app, text, el, sourcePath, component);
	const pair = (el: HTMLElement, lv: LabelValue) => {
		el.createSpan({ cls: "strakes-stat-key", text: lv.label });
		el.appendText(` ${lv.value}`);
	};

	// Cabecera: nombre, tipo, bloque superior y características (no se parte entre columnas).
	const head = sb.createDiv("strakes-stat-head");
	head.createDiv({ cls: "strakes-stat-name", text: layout.name });
	if (layout.subtitle) head.createDiv({ cls: "strakes-stat-subtitle", text: layout.subtitle });
	if (layout.top.length || layout.speed) {
		const top = head.createDiv("strakes-stat-top");
		for (const row of layout.top)
			for (const c of row) {
				const cell = top.createDiv("strakes-stat-top-cell");
				if (c) pair(cell, c);
			}
		if (layout.speed) pair(top.createDiv("strakes-stat-top-cell is-wide"), { label: T("statblock.speed"), value: layout.speed });
	}
	if (layout.abilities) {
		const grid = head.createDiv("strakes-stat-abilities");
		for (const a of layout.abilities) grid.createDiv({ cls: "strakes-stat-ability-label", text: a.label });
		grid.createDiv();
		for (const a of layout.abilities) grid.createDiv({ cls: "strakes-stat-ability-score", text: a.score });
		grid.createDiv();
		for (const a of layout.abilities) grid.createDiv({ text: a.mod });
		grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.mod") });
		for (const a of layout.abilities) grid.createDiv({ text: a.save });
		grid.createDiv({ cls: "strakes-stat-row-label", text: T("statblock.save") });
	}

	// Todas las habilidades: tabla de cuatro columnas, de arriba abajo.
	if (layout.allSkills?.length) {
		const skills = layout.allSkills;
		const grid = sb.createDiv("strakes-stat-all-skills");
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
		sec.createDiv({ cls: "strakes-stat-section-title", text: s.title });
		if (s.intro) renders.push(markdown(sec.createDiv("strakes-stat-entry"), s.intro));
		for (const e of s.entries) renders.push(markdown(sec.createDiv("strakes-stat-entry"), e));
	}
	await Promise.all(renders);
	return wrap;
}
