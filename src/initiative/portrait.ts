import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { Combatant, Portrait } from "../types";
import { ImagePickerModal, loadImageSize } from "../ui/modals";

// ---------- Nombres, etiquetas y memoria ----------

/** «Goblin 3» → { base: "Goblin", number: "3" }. */
export function splitName(name: string): { base: string; number: string } {
	const m = name.trim().match(/^(.*?)\s+(\d+)$/);
	return m ? { base: m[1], number: m[2] } : { base: name.trim(), number: "" };
}

/** Etiqueta sin retrato: inicial del nombre + número si lo tiene («Goblin 3» → «G3»). */
export function placeholderLabel(name: string): string {
	const { base, number } = splitName(name);
	const initial = (base.match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();
	return initial + number;
}

/** Clave para recordar el retrato por nombre (sin número ni mayúsculas). */
export function memoryKey(name: string): string {
	return splitName(name).base.toLowerCase();
}

export function rememberPortrait(plugin: StrakesTTRPG, name: string, portrait: Portrait | null | undefined): void {
	if (!portrait) return;
	plugin.settings.portraitMemory[memoryKey(name)] = { ...portrait };
}

export function recalledPortrait(plugin: StrakesTTRPG, name: string): Portrait | null {
	const p = plugin.settings.portraitMemory[memoryKey(name)];
	return p ? { ...p } : null;
}

// ---------- Dibujo ----------

/**
 * Pinta el retrato cuadrado de un combatiente en `el` (que debe tener tamaño cuadrado).
 * Sin retrato (o si la imagen ya no existe): la etiqueta «G1» sobre azul (PJ/aliado)
 * o rojo (enemigo).
 */
export function renderPortrait(app: App, el: HTMLElement, c: Combatant): void {
	el.empty();
	el.addClass("strakes-portrait");
	const p = c.portrait;
	const file = p ? app.vault.getAbstractFileByPath(p.path) : null;
	if (p && file instanceof TFile) {
		const img = el.createEl("img", { attr: { src: app.vault.getResourcePath(file), draggable: "false", alt: "" } });
		applyCrop(img, p);
		return;
	}
	el.addClass(c.isPlayer ? "is-ally" : "is-enemy");
	el.createSpan({ cls: "strakes-portrait-label", text: placeholderLabel(c.name) });
}

/** Coloca la imagen según el encuadre (en % del lado del marco). */
function applyCrop(img: HTMLImageElement, p: Portrait): void {
	img.setCssStyles({ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.scale * 100}%` });
}

/** Encuadre que cubre el marco entero con la imagen (sin huecos), centrado. */
export function coverCrop(path: string, width: number, height: number): Portrait {
	const a = width / height;
	return a >= 1 ? { path, scale: a, x: (1 - a) / 2, y: 0 } : { path, scale: 1, x: 0, y: (1 - 1 / a) / 2 };
}

/** Encuadre que muestra la imagen entera dentro del marco, centrada. */
export function fitCrop(path: string, width: number, height: number): Portrait {
	const a = width / height;
	return a >= 1 ? { path, scale: 1, x: 0, y: (1 - 1 / a) / 2 } : { path, scale: a, x: (1 - a) / 2, y: 0 };
}

// ---------- Elegir y encuadrar ----------

/**
 * Flujo completo: si ya hay retrato, abre el editor; si no, elige una imagen de la
 * bóveda y después el editor. `onDone(null)` = retrato quitado; no se llama si se cancela.
 */
/**
 * @param name Nombre del personaje: el buscador de imágenes se abre con él escrito (sin el
 * número: «Goblin 3» → «Goblin»).
 */
export function editPortrait(app: App, current: Portrait | null | undefined, onDone: (p: Portrait | null) => void, name = ""): void {
	if (current && app.vault.getAbstractFileByPath(current.path) instanceof TFile) {
		new PortraitModal(app, current, onDone, name).open();
		return;
	}
	pickPortraitImage(app, (p) => new PortraitModal(app, p, onDone, name).open(), name);
}

function pickPortraitImage(app: App, onPicked: (p: Portrait) => void, name = ""): void {
	new ImagePickerModal(
		app,
		(file) => {
			void loadImageSize(app.vault.getResourcePath(file))
				.then(({ width, height }) => onPicked(coverCrop(file.path, width, height)))
				.catch(() => new Notice(T("No se pudo cargar la imagen", "Couldn't load the image")));
		},
		T("Elige la imagen del retrato…", "Choose the portrait image…"),
		splitName(name).base,
	).open();
}

/**
 * Editor de encuadre: un marco cuadrado en el centro de un área más grande. La imagen
 * entera se ve detrás, semitransparente fuera del marco; arrastrar = mover, rueda o
 * barra = zoom. Se puede salir de los límites de la imagen (esa zona queda transparente).
 */
export class PortraitModal extends Modal {
	private p: Portrait;
	private natural = { width: 1, height: 1 };
	private stage!: HTMLElement;
	private ghost!: HTMLImageElement;
	private framed!: HTMLImageElement;
	private zoomSlider: HTMLInputElement | null = null;
	private zoomNumber: HTMLInputElement | null = null;

	/** Lado del marco y del área de trabajo en px. */
	private static readonly FRAME = 240;
	private static readonly STAGE = 420;
	/** Límites del zoom en la barra: ln(escala)·1000 → del 5 % al 2000 %. */
	private static readonly ZOOM_MIN_LOG = Math.round(Math.log(0.05) * 1000);
	private static readonly ZOOM_MAX_LOG = Math.round(Math.log(20) * 1000);

	constructor(
		app: App,
		portrait: Portrait,
		private onDone: (p: Portrait | null) => void,
		/** Nombre del personaje, para el buscador de «Cambiar imagen…». */
		private name = "",
	) {
		super(app);
		this.p = { ...portrait };
	}

	onOpen(): void {
		this.titleEl.setText(T("Encuadrar retrato", "Frame portrait"));
		this.modalEl.addClass("strakes-portrait-modal");
		const el = this.contentEl;
		el.createDiv({ cls: "setting-item-description", text: T("Arrastra para mover la imagen y usa la rueda (o la barra) para acercar o alejar. Lo que queda dentro del marco es el retrato.", "Drag to move the image and use the wheel (or the slider) to zoom in or out. Whatever stays inside the frame is the portrait.") });

		const F = PortraitModal.FRAME;
		const S = PortraitModal.STAGE;
		this.stage = el.createDiv("strakes-portrait-stage");
		this.stage.setCssStyles({ width: `${S}px`, height: `${S}px` });
		const src = this.srcFor(this.p.path);
		// Imagen completa, semitransparente (para ver lo que queda fuera del marco).
		this.ghost = this.stage.createEl("img", { cls: "strakes-portrait-ghost", attr: { src, draggable: "false", alt: "" } });
		// Marco cuadrado con la misma imagen a opacidad completa.
		const frame = this.stage.createDiv("strakes-portrait-frame");
		frame.setCssStyles({ width: `${F}px`, height: `${F}px`, left: `${(S - F) / 2}px`, top: `${(S - F) / 2}px` });
		this.framed = frame.createEl("img", { attr: { src, draggable: "false", alt: "" } });

		void loadImageSize(src).then((n) => {
			this.natural = n;
			this.syncSlider();
		});

		this.bindDrag();
		this.stage.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const r = this.stage.getBoundingClientRect();
				this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
			},
			{ passive: false },
		);

		// Zoom: barra a todo el ancho (escala logarítmica, muchos pasos) y porcentaje editable,
		// sincronizados en tiempo real con la rueda y los botones.
		const zoomRow = el.createDiv("strakes-portrait-zoom");
		zoomRow.createSpan({ cls: "strakes-portrait-zoom-label", text: T("Zoom", "Zoom") });
		const slider = zoomRow.createEl("input", { type: "range", cls: "slider strakes-portrait-zoom-slider" });
		slider.min = String(PortraitModal.ZOOM_MIN_LOG);
		slider.max = String(PortraitModal.ZOOM_MAX_LOG);
		slider.step = "1";
		this.zoomSlider = slider;
		slider.addEventListener("input", () => {
			const target = Math.exp(parseInt(slider.value, 10) / 1000);
			this.zoomAt(target / this.p.scale, S / 2, S / 2, false);
			this.syncZoomNumber();
		});
		const num = zoomRow.createEl("input", { type: "number", cls: "strakes-portrait-zoom-num", attr: { min: "5", max: "2000", step: "1" } });
		this.zoomNumber = num;
		zoomRow.createSpan({ text: "%" });
		num.addEventListener("change", () => {
			const pct = parseFloat(num.value);
			if (isNaN(pct) || pct <= 0) return this.syncZoomNumber();
			this.zoomAt(pct / 100 / this.p.scale, S / 2, S / 2);
		});

		new Setting(el)
			.addButton((b) => b.setButtonText(T("Cambiar imagen…", "Change image…")).onClick(() => pickPortraitImage(this.app, (np) => this.setImage(np), this.name)))
			.addButton((b) => b.setButtonText(T("Encajar", "Fit")).setTooltip(T("Imagen completa dentro del marco", "Whole image inside the frame")).onClick(() => this.preset(fitCrop)))
			.addButton((b) => b.setButtonText(T("Rellenar", "Fill")).setTooltip(T("La imagen cubre todo el marco", "The image covers the whole frame")).onClick(() => this.preset(coverCrop)));
		new Setting(el)
			.addButton((b) =>
				b
					.setButtonText(T("Quitar retrato", "Remove portrait"))
					.setDestructive()
					.onClick(() => this.finish(null)),
			)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("Guardar", "Save"))
					.setCta()
					.onClick(() => this.finish(this.p)),
			);
		this.render();
		this.syncSlider();
	}

	private srcFor(path: string): string {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? this.app.vault.getResourcePath(f) : "";
	}

	private setImage(p: Portrait): void {
		this.p = p;
		const src = this.srcFor(p.path);
		this.ghost.src = src;
		this.framed.src = src;
		void loadImageSize(src).then((n) => {
			this.natural = n;
			this.syncSlider();
		});
		this.render();
	}

	private preset(fn: (path: string, w: number, h: number) => Portrait): void {
		this.p = fn(this.p.path, this.natural.width, this.natural.height);
		this.syncSlider();
		this.render();
	}

	/** Zoom manteniendo fijo el punto (px, py) del área de trabajo. */
	private zoomAt(factor: number, px: number, py: number, updateSlider = true): void {
		const F = PortraitModal.FRAME;
		const off = (PortraitModal.STAGE - F) / 2;
		const next = Math.min(20, Math.max(0.05, this.p.scale * factor));
		const k = next / this.p.scale;
		// Punto bajo el cursor en coordenadas del marco (en lados de marco).
		const fx = (px - off) / F;
		const fy = (py - off) / F;
		this.p.x = fx - (fx - this.p.x) * k;
		this.p.y = fy - (fy - this.p.y) * k;
		this.p.scale = next;
		if (updateSlider) this.syncSlider();
		this.render();
	}

	private syncSlider(): void {
		if (this.zoomSlider) this.zoomSlider.value = String(Math.round(Math.log(this.p.scale) * 1000));
		this.syncZoomNumber();
	}

	private syncZoomNumber(): void {
		if (this.zoomNumber && this.zoomNumber.doc.activeElement !== this.zoomNumber) this.zoomNumber.value = String(Math.round(this.p.scale * 100));
	}

	private bindDrag(): void {
		let last: { x: number; y: number } | null = null;
		this.stage.addEventListener("pointerdown", (e) => {
			last = { x: e.clientX, y: e.clientY };
			this.stage.setPointerCapture(e.pointerId);
			this.stage.addClass("is-dragging");
		});
		this.stage.addEventListener("pointermove", (e) => {
			if (!last) return;
			const F = PortraitModal.FRAME;
			this.p.x += (e.clientX - last.x) / F;
			this.p.y += (e.clientY - last.y) / F;
			last = { x: e.clientX, y: e.clientY };
			this.render();
		});
		const end = () => {
			last = null;
			this.stage.removeClass("is-dragging");
		};
		this.stage.addEventListener("pointerup", end);
		this.stage.addEventListener("pointercancel", end);
	}

	private render(): void {
		const F = PortraitModal.FRAME;
		const off = (PortraitModal.STAGE - F) / 2;
		const { x, y, scale } = this.p;
		this.ghost.setCssStyles({ left: `${off + x * F}px`, top: `${off + y * F}px`, width: `${scale * F}px` });
		this.framed.setCssStyles({ left: `${x * F}px`, top: `${y * F}px`, width: `${scale * F}px` });
		this.syncZoomNumber();
	}

	private finish(result: Portrait | null): void {
		this.onDone(result ? { ...result } : null);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
