import { App, Component, MarkdownRenderer } from "obsidian";
import { T, TC } from "../i18n";
import { Statblock } from "./data";
import { Boxes, LabelValue, LayoutEntry, LayoutSection, StatblockLayout } from "./layout";
import { UseRef } from "./uses";

/** Columnas de un statblock: las suyas (`columns`) o las de su preset. */
export function statblockColumns(sb: Statblock, presetColumns: 1 | 2): 1 | 2 {
	return sb.columns ?? presetColumns;
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
 * Las partes van en el orden del preset (`layout.order`, paso 8). Las de la cabecera seguidas forman un
 * bloque que no se parte entre columnas, y las líneas seguidas, otro con su margen; con el orden de
 * «D&D 2024» queda como antes de los presets.
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
	/** Convierte las marcas de enlace del statblock (líneas, entradas…) en enlaces (paso 6; `links/linkify.ts`). */
	linkify?: (el: HTMLElement) => void,
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

	// Grupo en el que van las partes seguidas del mismo tipo (cabecera o líneas).
	let group: { kind: "head" | "lines"; el: HTMLElement } | null = null;
	const inGroup = (kind: "head" | "lines") => {
		if (group?.kind !== kind) group = { kind, el: sb.createDiv(kind === "head" ? "strakes-stat-head" : "strakes-stat-lines") };
		return group.el;
	};
	const alone = (cls: string) => {
		group = null;
		return sb.createDiv(cls);
	};
	const renders: Promise<void>[] = [];
	const section = (s: LayoutSection) => {
		const sec = alone("strakes-stat-section");
		const title = mark(sec.createDiv({ cls: "strakes-stat-section-title", text: s.title }), `section:${s.key}`);
		if (s.boxes) title.appendChild(renderBoxes(s.boxes, onUse));
		const introTarget = s.key === "legendary_actions" ? "legendary_header" : s.key === "lair_actions" ? "lair_actions_header" : `section:${s.key}`;
		if (s.intro) renders.push(markdown(mark(sec.createDiv("strakes-stat-entry"), introTarget), s.intro));
		for (const e of s.entries) renders.push(renderEntry(mark(sec.createDiv("strakes-stat-entry"), e.target), e, markdown, onUse, mark));
	};

	for (const item of layout.order) {
		if (item === "header") {
			const head = inGroup("head");
			mark(head.createDiv({ cls: "strakes-stat-name", text: layout.name }), "name");
			if (layout.subtitle) mark(head.createDiv({ cls: "strakes-stat-subtitle", text: layout.subtitle }), "subtitle");
		} else if (item === "defense") {
			if (!layout.top.length) continue;
			const top = inGroup("head").createDiv("strakes-stat-top");
			for (const row of layout.top)
				for (const c of row) {
					const cell = top.createDiv("strakes-stat-top-cell");
					if (c) pair(cell, c);
				}
		} else if (item === "speed") {
			if (!layout.speed) continue;
			const top = inGroup("head").createDiv("strakes-stat-top");
			pair(top.createDiv("strakes-stat-top-cell is-wide"), { label: TC("statblock.speed"), value: layout.speed, field: "speed" });
		} else if (item === "abilities") {
			if (layout.abilities) renderAbilities(inGroup("head"), layout.abilities, layout.saves, mark);
		} else if (item === "skills" && layout.allSkills?.length) {
			renderAllSkills(mark(alone("strakes-stat-all-skills"), "skills"), layout.allSkills);
		} else {
			const line = layout.lines.find((l) => l.item === item);
			if (line) pair(inGroup("lines").createDiv("strakes-stat-line"), line);
			const sec = layout.sections.find((s) => s.key === item);
			if (sec) section(sec);
		}
	}
	await Promise.all(renders);
	linkify?.(sb);
	return wrap;
}

/** Tabla de características: abreviaturas, puntuaciones, modificadores y (si el preset la muestra) salvaciones. */
function renderAbilities(
	parent: HTMLElement,
	abilities: NonNullable<StatblockLayout["abilities"]>,
	saves: boolean,
	mark: (el: HTMLElement, target: string | undefined) => HTMLElement,
): void {
	const grid = parent.createDiv("strakes-stat-abilities");
	const cell = (a: (typeof abilities)[number], o: { cls?: string; text: string }) => mark(grid.createDiv(o), `ability:${a.ability}`);
	for (const a of abilities) cell(a, { cls: "strakes-stat-ability-label", text: a.label });
	grid.createDiv();
	for (const a of abilities) cell(a, { cls: "strakes-stat-ability-score", text: a.score });
	grid.createDiv();
	for (const a of abilities) cell(a, { text: a.mod });
	grid.createDiv({ cls: "strakes-stat-row-label", text: TC("statblock.mod") });
	if (!saves) return;
	for (const a of abilities) cell(a, { text: a.save });
	grid.createDiv({ cls: "strakes-stat-row-label", text: TC("statblock.save") });
}

/** Todas las habilidades: tabla de cuatro columnas, de arriba abajo. */
function renderAllSkills(grid: HTMLElement, skills: LabelValue[]): void {
	const half = Math.ceil(skills.length / 2);
	for (let h = 0; h < 2; h++) {
		grid.createDiv({ cls: "strakes-stat-row-label", text: TC("statblock.skillHeader") });
		grid.createDiv({ cls: "strakes-stat-row-label", text: TC("statblock.mod") });
	}
	for (let i = 0; i < half; i++)
		for (const s of [skills[i], skills[i + half]]) {
			grid.createDiv({ text: s?.label ?? "" });
			grid.createDiv({ text: s?.value ?? "" });
		}
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
			// La nota, en texto normal, como en los libros («*Invisibilidad* (solo sobre sí mismo)»). Sus marcas
			// de enlace las convierte `linkify` al final.
			if (s.note) row.appendText(s.note);
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
