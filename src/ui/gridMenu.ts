import { setIcon } from "obsidian";

/** Una opción del menú en columnas. */
export interface GridMenuItem {
	title: string;
	/** Marcada (con la marca de Obsidian a la derecha). */
	checked?: boolean;
	/** Icono de Lucide, o una función que lo dibuja (p. ej. el de una condición). */
	icon?: string;
	renderIcon?: (el: HTMLElement) => void;
	onClick: () => void;
}

/**
 * Menú propio en columnas, con el aspecto del de Obsidian (sus mismas clases: `menu`, `menu-item`,
 * `menu-item-icon`, `menu-item-title`). El de Obsidian es de una sola columna y su API no deja tocar su
 * contenido, así que con muchas opciones se hacía muy largo (pedido del desarrollador, 1.4).
 *  - Las opciones se reparten en columnas de `perColumn` como máximo, de arriba abajo.
 *  - `footer`: opciones aparte, debajo de todas, tras un separador.
 *  - Se cierra al elegir una opción, con un clic fuera o con Escape.
 */
export function showGridMenu(evt: MouseEvent, items: GridMenuItem[], footer: GridMenuItem[] = [], perColumn = 10): void {
	const doc = (evt.target as Node | null)?.ownerDocument ?? activeDocument;
	const win = doc.defaultView ?? window;
	const menu = doc.body.createDiv("menu strakes-grid-menu");
	const grid = menu.createDiv("strakes-grid-menu-grid");
	grid.setCssProps({ "--strakes-grid-rows": String(Math.min(perColumn, Math.max(1, items.length))) });

	const onDown = (e: PointerEvent) => {
		if (!menu.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		close();
	};
	const close = () => {
		menu.remove();
		doc.removeEventListener("pointerdown", onDown, true);
		doc.removeEventListener("keydown", onKey, true);
	};
	const add = (parent: HTMLElement, it: GridMenuItem) => {
		const el = parent.createDiv("menu-item");
		const icon = el.createDiv("menu-item-icon");
		if (it.renderIcon) it.renderIcon(icon);
		else if (it.icon) setIcon(icon, it.icon);
		el.createDiv({ cls: "menu-item-title", text: it.title });
		if (it.checked) setIcon(el.createDiv("menu-item-icon mod-checked"), "check");
		// Como en el menú de Obsidian: la opción bajo el cursor se resalta con «selected».
		el.addEventListener("mouseenter", () => el.addClass("selected"));
		el.addEventListener("mouseleave", () => el.removeClass("selected"));
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			close();
			it.onClick();
		});
	};
	for (const it of items) add(grid, it);
	if (footer.length) {
		menu.createDiv("menu-separator");
		for (const it of footer) add(menu, it);
	}

	// Donde se hizo clic, sin salirse de la ventana.
	const r = menu.getBoundingClientRect();
	const x = Math.max(8, Math.min(evt.clientX, win.innerWidth - r.width - 8));
	const y = Math.max(8, Math.min(evt.clientY, win.innerHeight - r.height - 8));
	menu.setCssStyles({ left: `${x}px`, top: `${y}px` });
	doc.addEventListener("pointerdown", onDown, true);
	doc.addEventListener("keydown", onKey, true);
}
