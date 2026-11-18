import { App, HoverParent, HoverPopover } from "obsidian";
import { linktextOf, parseWikilink, resolveWikilink } from "./links";

/**
 * "Padre" de la vista previa nativa de Obsidian para los pines del mapa.
 * Obsidian asigna aquí la ventana emergente (hoverPopover) al crearla; aprovechamos
 * ese momento para añadir arriba el título de la nota, que la vista previa no muestra.
 * Solo con enlaces a la nota completa: un encabezado o un bloque ya se ven solos (decisión del
 * desarrollador). Solo afecta a las vistas previas lanzadas desde los mapas.
 */
export class PinHoverParent implements HoverParent {
	private popover: HoverPopover | null = null;
	private title = "";

	/** @param showTitle se consulta en cada vista previa (ajuste del plugin). */
	constructor(private showTitle: () => boolean) {}

	get hoverPopover(): HoverPopover | null {
		return this.popover;
	}

	set hoverPopover(p: HoverPopover | null) {
		this.popover = p;
		if (!p || !this.title) return;
		p.hoverEl.querySelector(":scope > .strakes-hover-title")?.remove();
		// La ventana coloca sus hijos en fila; esta clase la pasa a columna (título encima).
		p.hoverEl.addClass("strakes-pin-preview");
		p.hoverEl.prepend(createDiv({ cls: "strakes-hover-title", text: this.title }));
	}

	/** Lanza la vista previa de la nota enlazada de un marcador, una ruta o una zona (respeta el ajuste de Ctrl de Obsidian). */
	show(app: App, pin: { link?: string }, event: MouseEvent, targetEl: HTMLElement | undefined, sourcePath: string): void {
		if (!pin.link) return;
		const file = resolveWikilink(app, pin.link, sourcePath);
		const { subpath, linkpath } = parseWikilink(pin.link);
		this.title = !this.showTitle() || subpath ? "" : (file?.basename ?? linkpath);
		app.workspace.trigger("hover-link", {
			event,
			source: "strakes-ttrpg",
			hoverParent: this,
			targetEl,
			linktext: linktextOf(pin.link),
			sourcePath,
		});
	}
}
