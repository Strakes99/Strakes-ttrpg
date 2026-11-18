import * as L from "leaflet";
import { App, Component, Keymap, Menu, Notice, setIcon, setTooltip, TFile } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { resizeObserverFor } from "../ui/dom";
import { loadImageSize } from "../ui/modals";
import { PinHoverParent } from "./hover";
import { linktextOf, resolveWikilink } from "./links";
import { isItemVisible, ItemType, MapData, MapPin, MapZone, newMapUnit, nodeMap, normalizeMap, ROUTE_COLORS, routePath } from "./mapData";
import { LabelState } from "../types";
import { ensureZonePane, mapBounds, nodeMarker, pinIcon, pinTooltipOptions, pinTooltipText, routeNameLabel, toLatLng, zoneNameLabel, zoneStyle } from "./render";
import { FogLayer } from "./fogLayer";

/** Lo que Obsidian pasa a quien crea un embed (API interna `app.embedRegistry`). */
export interface EmbedContext {
	app: App;
	containerEl: HTMLElement;
	linktext: string;
	sourcePath: string;
}

const DEFAULT_HEIGHT = 400;

/**
 * Mapa incrustado en una nota con ![[mapa.smap]]: vista interactiva de solo lectura.
 *  - ![[mapa.smap|300]]      → alto 300 px
 *  - ![[mapa.smap|800x300]]  → ancho 800 px y alto 300 px
 *  - ![[mapa.smap#Pin]]      → centrado en el pin con ese nombre
 */
export class MapEmbed extends Component {
	private data: MapData | null = null;
	private map: L.Map | null = null;
	private wrapper: HTMLElement | null = null;
	private mapEl: HTMLElement | null = null;
	private imageOverlay: L.ImageOverlay | null = null;
	private loadedImage = "";
	private content: L.LayerGroup | null = null;
	/** Visibilidad de tipos y capas solo para este embed (no modifica el archivo). */
	private layerOverride = new Map<string, boolean>();
	private typeOverride: Partial<Record<ItemType, boolean>> = {};
	private fitted = false;
	/** Tamaño escrito en el enlace (|alto o |anchoxalto). null = se ajusta a la proporción del mapa. */
	private explicitSize: { width: number | null; height: number } | null = null;
	/** true mientras se ve el mapa completo encuadrado: al cambiar el tamaño, se re-encuadra. */
	private showingWhole = false;
	private fitting = false;
	/** Lo que hay que deshacer al quitar el mapa construido (observador de tamaño, rueda). */
	private domCleanup: (() => void)[] = [];
	private pinHover = new PinHoverParent(() => this.plugin.settings.pinPreviewTitle);
	/** Etiquetas de este mapa (no se guardan: al volver a dibujar la nota, apagadas). */
	private labels: LabelState = { pins: false, routes: false, zones: false };
	/** Niebla de guerra, semitransparente (vista del DM), y si está oculta (botón de la nube; no se recuerda). */
	private fogLayer: FogLayer | null = null;
	private fogHidden = false;
	/** Candado de este mapa (no se recuerda: al volver a dibujar la nota, abierto). */
	private locked = false;
	private toolbarEl: HTMLElement | null = null;

	constructor(
		private plugin: StrakesTTRPG,
		private ctx: EmbedContext,
		private file: TFile,
		private subpath: string,
	) {
		super();
	}

	private get app(): App {
		return this.ctx.app;
	}

	onload(): void {
		this.registerEvent(this.plugin.events.on("icons", () => this.render()));
		// Ajuste «Bloquear los mapas incrustados»: bloquea y quita (o devuelve) el candado.
		this.registerEvent(
			this.plugin.events.on("settings", () => {
				// También redibuja: la transparencia del relleno de las zonas es un ajuste.
				this.render();
				this.applyLock();
				if (this.wrapper) this.buildToolbar(this.wrapper);
			}),
		);
		// Si la imagen del mapa aparece después (se crea, se mueve o se renombra a esa ruta),
		// se carga en ese momento.
		const imageAppeared = (path: string) => {
			if (this.data && path === this.data.image && !this.imageOverlay) this.render();
		};
		this.registerEvent(this.app.vault.on("create", (f) => imageAppeared(f.path)));
		this.registerEvent(this.app.vault.on("rename", (f) => imageAppeared(f.path)));
		// Si se edita el mapa (en su vista de edición u otro sitio), el embed se refresca.
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (f === this.file) void this.loadFile();
			}),
		);
	}

	onunload(): void {
		this.teardown();
	}

	/** Quita el mapa construido: así, si el archivo vuelve a ser válido, buildDom lo crea de nuevo. */
	private teardown(): void {
		for (const fn of this.domCleanup.splice(0)) fn();
		this.map?.remove();
		this.map = null;
		this.wrapper = null;
		this.toolbarEl = null;
		this.mapEl = null;
		this.content = null;
		this.imageOverlay = null;
		this.loadedImage = "";
		this.fitted = false;
	}

	/** Obsidian lo llama tras crear el embed. */
	async loadFile(): Promise<void> {
		try {
			this.data = normalizeMap(JSON.parse(await this.app.vault.cachedRead(this.file)), newMapUnit(this.plugin.settings.displayUnit));
		} catch {
			this.data = null;
			this.teardown();
			this.ctx.containerEl.empty();
			this.ctx.containerEl.createDiv({ cls: "strakes-warning", text: T(`No se pudo leer el mapa ${this.file.basename}.`, `Couldn't read the map ${this.file.basename}.`) });
			return;
		}
		this.buildDom();
		// La barra depende del archivo (p. ej. el botón de la niebla): se rehace al cambiar.
		if (this.wrapper) this.buildToolbar(this.wrapper);
		this.render();
	}

	// ---------- DOM y Leaflet ----------

	private buildDom(): void {
		if (this.wrapper && this.map) return;
		const host = this.ctx.containerEl;
		host.empty();
		host.addClass("strakes-map-embed-host");

		this.explicitSize = this.parseSize();
		const wrapper = host.createDiv("strakes-map-embed");
		if (this.explicitSize) {
			wrapper.setCssStyles({ height: `${this.explicitSize.height}px` });
			if (this.explicitSize.width) wrapper.setCssStyles({ width: `${this.explicitSize.width}px` });
		} else {
			wrapper.setCssStyles({ height: `${DEFAULT_HEIGHT}px` }); // provisional hasta medir el ancho disponible
		}
		this.wrapper = wrapper;

		// Que los clics dentro del mapa no muevan el cursor del editor (Live Preview)
		// ni abran el enlace del embed.
		for (const type of ["mousedown", "pointerdown", "click", "dblclick", "contextmenu", "touchstart"])
			wrapper.addEventListener(type, (e) => e.stopPropagation());

		this.mapEl = wrapper.createDiv("strakes-map-embed-canvas");
		this.buildToolbar(wrapper);

		const map = L.map(this.mapEl, {
			crs: L.CRS.Simple,
			minZoom: -6,
			maxZoom: 5,
			// Sin redondeo del zoom: el encuadre se ajusta exacto al recuadro, sin bordes.
			zoomSnap: 0,
			zoomDelta: 0.5,
			wheelPxPerZoomLevel: 100,
			attributionControl: false,
			boxZoom: false,
			// La rueda la gestionamos nosotros (ver captureWheel).
			scrollWheelZoom: false,
		});
		this.map = map;
		this.content = L.layerGroup().addTo(map);
		ensureZonePane(map);
		this.fogLayer = new FogLayer(map, 0.5);
		this.domCleanup.push(() => {
			this.fogLayer?.remove();
			this.fogLayer = null;
		});
		this.captureWheel(wrapper);
		this.applyLock();
		map.on("zoomstart movestart", () => {
			if (!this.fitting) this.showingWhole = false;
		});

		// El embed puede crearse con tamaño 0 (aún no visible) y el panel puede cambiar de ancho:
		// recalculamos el alto según la proporción y re-encuadramos si se veía el mapa completo.
		const ro = resizeObserverFor(this.mapEl, () => {
			this.applyAutoSize();
			if (!this.map || !this.mapEl?.clientWidth) return;
			this.map.invalidateSize();
			if (!this.fitted) this.initialView();
			else if (this.showingWhole) this.fitWhole(false);
		});
		ro.observe(host);
		ro.observe(this.mapEl);
		this.domCleanup.push(() => ro.disconnect());
	}

	/**
	 * Sin tamaño explícito, el recuadro toma la proporción de la imagen: todo el ancho
	 * disponible y el alto que corresponda. Si el mapa es muy alto (vertical), se limita
	 * al 70 % de la ventana y se estrecha, centrado, para conservar la proporción.
	 */
	private applyAutoSize(): void {
		const data = this.data;
		const wrapper = this.wrapper;
		if (this.explicitSize || !wrapper || !data?.width || !data.height) return;
		const avail = this.ctx.containerEl.clientWidth;
		if (!avail) return;
		const border = wrapper.offsetWidth - wrapper.clientWidth; // ambos bordes
		const ratio = data.height / data.width;
		const maxH = Math.max(200, wrapper.win.innerHeight * 0.7);
		let innerW = avail - border;
		let innerH = innerW * ratio;
		if (innerH > maxH) {
			innerH = maxH;
			innerW = innerH / ratio;
		}
		const w = Math.round(innerW + border);
		const h = `${Math.round(innerH + border)}px`;
		const width = w < avail - 1 ? `${w}px` : "";
		if (wrapper.style.height !== h) wrapper.setCssStyles({ height: h });
		if (wrapper.style.width !== width) wrapper.setCssStyles({ width });
	}

	private fitWhole(animate: boolean): void {
		const map = this.map;
		const data = this.data;
		if (!map || !data) return;
		this.fitting = true;
		if (animate) {
			map.flyToBounds(mapBounds(data), { duration: 0.5 });
			map.once("moveend", () => {
				this.fitting = false;
				this.showingWhole = true;
			});
		} else {
			map.fitBounds(mapBounds(data), { animate: false });
			this.fitting = false;
			this.showingWhole = true;
		}
	}

	/**
	 * Zoom con la rueda en cuanto el puntero está sobre el mapa, sin hacer clic.
	 * Dentro de una nota la rueda no siempre llega al mapa: Obsidian puede interceptarla,
	 * o Chromium la mantiene «enganchada» a la nota mientras se desplaza. Por eso
	 * escuchamos en la ventana en fase de captura (antes que nadie) y comprobamos
	 * qué hay realmente bajo el puntero.
	 */
	private captureWheel(wrapper: HTMLElement): void {
		const win = wrapper.win;
		let delta = 0;
		let timer = 0;
		let around: L.Point | null = null;

		const perform = () => {
			timer = 0;
			const map = this.map;
			if (!map || !delta || !around) return;
			// Misma curva de aceleración que usa Leaflet para la rueda, redondeada hacia arriba al
			// incremento del zoom de los ajustes: cada paso de la rueda da un incremento.
			const step = this.plugin.settings.mapZoomStep > 0 ? this.plugin.settings.mapZoomStep : 0.5;
			const d2 = delta / ((100 / step) * 4);
			const d3 = (4 * Math.log(2 / (1 + Math.exp(-Math.abs(d2))))) / Math.LN2;
			const d4 = Math.ceil(d3 / step) * step;
			const zoom = map.getZoom();
			const target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom + (delta > 0 ? d4 : -d4)));
			delta = 0;
			if (target !== zoom) map.setZoomAround(around, target);
		};

		const onWheel = (e: WheelEvent) => {
			const map = this.map;
			// Bloqueado: la rueda desplaza la nota.
			if (!map || !wrapper.isConnected || this.isLocked()) return;
			const under = wrapper.doc.elementFromPoint(e.clientX, e.clientY);
			if (!under || !wrapper.contains(under)) return;
			if (under.closest(".strakes-map-embed-toolbar")) return;
			e.preventDefault();
			e.stopPropagation();
			delta += L.DomEvent.getWheelDelta(e);
			around = map.mouseEventToContainerPoint(e);
			if (timer) win.clearTimeout(timer);
			timer = win.setTimeout(perform, 40);
		};

		win.addEventListener("wheel", onWheel, { capture: true, passive: false });
		this.domCleanup.push(() => {
			win.removeEventListener("wheel", onWheel, { capture: true });
			if (timer) win.clearTimeout(timer);
		});
	}

	/** Bloqueado por su candado o por el ajuste «Bloquear los mapas incrustados». */
	private isLocked(): boolean {
		return this.locked || this.plugin.settings.lockAllEmbeds;
	}

	/** Bloqueado: sin zoom ni arrastre (la rueda la gestiona captureWheel). Los clics siguen funcionando. */
	private applyLock(): void {
		const map = this.map;
		if (!map) return;
		const on = !this.isLocked();
		for (const handler of [map.dragging, map.touchZoom, map.doubleClickZoom]) {
			if (on) handler.enable();
			else handler.disable();
		}
		this.wrapper?.toggleClass("is-locked", !on);
	}

	private buildToolbar(parent: HTMLElement): void {
		this.toolbarEl?.remove();
		const tb = parent.createDiv("strakes-map-embed-toolbar");
		this.toolbarEl = tb;
		const button = (icon: string, tip: string, onClick: (evt: MouseEvent) => void) => {
			const b = tb.createEl("button", { cls: "clickable-icon" });
			setIcon(b, icon);
			setTooltip(b, tip);
			b.onclick = (evt) => {
				evt.stopPropagation();
				onClick(evt);
			};
			return b;
		};
		button("layers", T("Capas", "Layers"), (evt) => this.layersMenu(evt));
		// Etiquetas: clic, todas a la vez; clic derecho, por tipo. Resaltado si hay alguna encendida.
		const anyLabel = this.labels.pins || this.labels.routes || this.labels.zones;
		const tag = button("tag", T("Etiquetas · clic derecho para elegirlas por tipo", "Labels · right-click to choose them by type"), () => {
			const on = !anyLabel;
			this.setLabels({ pins: on, routes: on, zones: on });
		});
		tag.toggleClass("is-active", anyLabel);
		tag.oncontextmenu = (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.labelsMenu(evt);
		};
		button("maximize", T("Encuadrar todo", "Fit all"), () => this.fitWhole(true));
		// Ocultar la niebla (solo si el mapa la tiene activada): no la borra.
		if (this.data?.fog?.enabled)
			button(
				this.fogHidden ? "cloud-off" : "cloud",
				this.fogHidden ? T("Niebla oculta (clic para mostrarla)", "Fog hidden (click to show it)") : T("Ocultar la niebla", "Hide the fog"),
				() => {
					this.fogHidden = !this.fogHidden;
					this.render();
					if (this.wrapper) this.buildToolbar(this.wrapper);
				},
			).toggleClass("is-active", this.fogHidden);
		// Candado: bloquea el zoom y el arrastre. Con el ajuste de bloquear todos, no aparece.
		if (!this.plugin.settings.lockAllEmbeds)
			button(
				this.locked ? "lock" : "unlock",
				this.locked
					? T("Bloqueado: sin zoom ni arrastre (clic para desbloquear)", "Locked: no zoom or dragging (click to unlock)")
					: T("Bloquear el zoom y el arrastre", "Lock zoom and dragging"),
				() => {
					this.locked = !this.locked;
					this.applyLock();
					if (this.wrapper) this.buildToolbar(this.wrapper);
				},
			);
		button("external-link", T("Abrir el mapa para editarlo", "Open the map to edit it"), (evt) => {
			void this.app.workspace.getLeaf(Keymap.isModEvent(evt) ? "split" : "tab").openFile(this.file);
		});
	}

	/** Lee el tamaño de ![[mapa.smap|alto]] o ![[mapa.smap|anchoxalto]]. */
	private parseSize(): { width: number | null; height: number } | null {
		const host = this.ctx.containerEl;
		const attrW = parseInt(host.getAttribute("width") ?? "", 10);
		const attrH = parseInt(host.getAttribute("height") ?? "", 10);
		const alt = (host.getAttribute("alt") ?? "").trim();
		const m = alt.match(/^(\d+)\s*(?:x\s*(\d+))?$/i);
		if (m && m[2]) return { width: parseInt(m[1], 10), height: Math.max(120, parseInt(m[2], 10)) };
		if (m) return { width: null, height: Math.max(120, parseInt(m[1], 10)) };
		if (!isNaN(attrH)) return { width: isNaN(attrW) ? null : attrW, height: Math.max(120, attrH) };
		return null;
	}

	private isVisible(type: ItemType, layerId: string | null): boolean {
		if (!this.data) return false;
		return isItemVisible(this.data, type, layerId, { types: this.typeOverride, layers: this.layerOverride });
	}

	private setLabels(labels: LabelState): void {
		this.labels = labels;
		this.render();
		if (this.wrapper) this.buildToolbar(this.wrapper);
	}

	private labelsMenu(evt: MouseEvent): void {
		const m = new Menu();
		const item = (key: keyof LabelState, title: string, icon: string) =>
			m.addItem((i) =>
				i
					.setTitle(title)
					.setIcon(icon)
					.setChecked(this.labels[key])
					.onClick(() => this.setLabels({ ...this.labels, [key]: !this.labels[key] })),
			);
		item("pins", T("Nombres de los marcadores", "Marker names"), "map-pin");
		item("routes", T("Nombres de las rutas", "Route names"), "route");
		item("zones", T("Nombres de las zonas", "Zone names"), "pentagon");
		m.showAtMouseEvent(evt);
	}

	private layersMenu(evt: MouseEvent): void {
		const data = this.data;
		if (!data) return;
		const m = new Menu();
		const typeItem = (type: ItemType, label: string, icon: string) => {
			const on = this.typeOverride[type] ?? (type === "pins" ? data.showPins : type === "routes" ? data.showRoutes : data.showZones);
			m.addItem((i) =>
				i
					.setTitle(label)
					.setIcon(icon)
					.setChecked(on)
					.onClick(() => {
						this.typeOverride[type] = !on;
						this.render();
					}),
			);
		};
		typeItem("pins", T("Marcadores", "Markers"), "map-pin");
		typeItem("routes", T("Rutas", "Routes"), "route");
		typeItem("zones", T("Zonas", "Zones"), "pentagon");
		if (data.layers.length) m.addSeparator();
		for (const layer of data.layers) {
			const on = this.layerOverride.get(layer.id) ?? layer.visible;
			m.addItem((i) =>
				i
					.setTitle(layer.name)
					.setChecked(on)
					.onClick(() => {
						this.layerOverride.set(layer.id, !on);
						this.render();
					}),
			);
		}
		m.showAtMouseEvent(evt);
	}

	// ---------- Contenido ----------

	private render(): void {
		const data = this.data;
		const map = this.map;
		const content = this.content;
		if (!data || !map || !content) return;

		// Se reintenta mientras no haya imagen (como en el editor): si no existía o no se
		// conocía su tamaño, se carga en cuanto sea posible. La clave incluye el tamaño para
		// rehacer el encuadre si cambia.
		const imageKey = `${data.image}|${data.width}x${data.height}`;
		if (imageKey !== this.loadedImage || !this.imageOverlay) {
			this.imageOverlay?.remove();
			this.imageOverlay = null;
			this.loadedImage = imageKey;
			const img = this.app.vault.getAbstractFileByPath(data.image);
			if (img instanceof TFile) {
				const src = this.app.vault.getResourcePath(img);
				if (data.width && data.height) {
					// La imagen va en el panel más bajo de Leaflet: por encima quedan zonas, rutas y marcadores.
					this.imageOverlay = L.imageOverlay(src, mapBounds(data), { interactive: false, pane: "tilePane" }).addTo(map);
					this.imageOverlay.bringToBack();
					map.setMaxBounds(mapBounds(data).pad(0.5));
				} else this.measureImage(data, src);
			}
		}

		content.clearLayers();
		this.fogLayer?.set(this.fogHidden ? undefined : data.fog, mapBounds(data), data.zones);
		// Zonas (vista del DM), por debajo de rutas y marcadores.
		for (const zone of data.zones) if (!zone.hidden && this.isVisible("zones", zone.layerId)) this.addZone(zone, content);
		const nodes = nodeMap(data);
		for (const route of data.routes) {
			if (route.hidden || !this.isVisible("routes", route.layerId)) continue;
			// La línea muestra su nombre al pasar el cursor (salvo con las etiquetas de ruta, que ya lo
			// muestran) y, con nota enlazada, clic para abrirla y Ctrl+cursor para la vista previa.
			const line = L.polyline(
				routePath(route, nodes).map((p) => toLatLng(p)),
				{ color: route.color || ROUTE_COLORS[0], weight: 4, opacity: 0.9, bubblingMouseEvents: false },
			);
			if (!this.labels.routes && route.name.trim()) line.bindTooltip(route.name, { sticky: true, className: "strakes-map-tooltip" });
			if (route.link) {
				const link = route.link;
				line.on("click", (e: L.LeafletMouseEvent) => this.openNote(link, e.originalEvent));
				line.on("mouseover", (e: L.LeafletMouseEvent) => this.pinHover.show(this.app, route, e.originalEvent, undefined, this.file.path));
			}
			content.addLayer(line);
			// Como en la pantalla de jugadores: el nombre de la ruta una vez, sin tramos.
			if (this.labels.routes) {
				const label = routeNameLabel(route, nodes);
				if (label) content.addLayer(label);
			}
			for (const id of route.nodeIds) {
				const n = nodes.get(id);
				if (n) content.addLayer(nodeMarker(n, route.color, { draggable: false, interactive: false }));
			}
		}
		for (const pin of data.pins) if (!pin.hidden && this.isVisible("pins", pin.layerId)) content.addLayer(this.pinMarker(pin));

		// Primero el tamaño según la proporción, luego el encuadre.
		this.applyAutoSize();
		if (!this.fitted && this.mapEl?.clientWidth) {
			map.invalidateSize();
			this.initialView();
		}
	}

	/** Zona del incrustado: clic abre su nota; Ctrl+cursor, la vista previa; su nombre al pasar o en su centro. */
	private addZone(zone: MapZone, content: L.LayerGroup): void {
		const poly = L.polygon(
			zone.points.map((p) => toLatLng(p)),
			{ ...zoneStyle(zone, this.plugin.settings.zoneFillTransparency), bubblingMouseEvents: false },
		);
		if (this.labels.zones) {
			const label = zoneNameLabel(zone);
			if (label) content.addLayer(label);
		} else if (zone.name.trim()) poly.bindTooltip(zone.name, { sticky: true, className: "strakes-map-tooltip" });
		poly.on("click", (e: L.LeafletMouseEvent) => {
			if (zone.link) this.openNote(zone.link, e.originalEvent);
		});
		poly.on("mouseover", (e: L.LeafletMouseEvent) => {
			if (zone.link) this.pinHover.show(this.app, zone, e.originalEvent, undefined, this.file.path);
		});
		content.addLayer(poly);
	}

	/** Abre la nota enlazada de una zona o una ruta (Ctrl/Cmd+clic: en pestaña nueva). */
	private openNote(link: string, evt: MouseEvent): void {
		if (!resolveWikilink(this.app, link, this.file.path)) {
			new Notice(T(`No se encuentra la nota ${link}`, `Note not found: ${link}`));
			return;
		}
		void this.app.workspace.openLinkText(linktextOf(link), this.file.path, Keymap.isModEvent(evt));
	}

	private pinMarker(pin: MapPin): L.Marker {
		const marker = L.marker(toLatLng(pin), { icon: pinIcon(pin), keyboard: false, riseOnHover: true });
		marker.bindTooltip(pinTooltipText(pin), pinTooltipOptions(pin, this.labels.pins));
		// Clic principal: abrir la nota enlazada.
		marker.on("click", (e: L.LeafletMouseEvent) => {
			if (!pin.link) return;
			if (!resolveWikilink(this.app, pin.link, this.file.path)) {
				new Notice(T(`No se encuentra la nota ${pin.link}`, `Note not found: ${pin.link}`));
				return;
			}
			void this.app.workspace.openLinkText(linktextOf(pin.link), this.file.path, Keymap.isModEvent(e.originalEvent));
		});
		// Clic derecho: si es portal / escalera, teletransporta directamente.
		marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stop(e.originalEvent);
			if (pin.portal) this.goPortal(pin);
		});
		marker.on("mouseover", (e: L.LeafletMouseEvent) =>
			this.pinHover.show(this.app, pin, e.originalEvent, marker.getElement(), this.file.path),
		);
		return marker;
	}

	private goPortal(pin: MapPin): void {
		const data = this.data;
		const map = this.map;
		if (!data || !map) return;
		const target = pin.targetPinId ? data.pins.find((p) => p.id === pin.targetPinId) : null;
		const dest = target ?? pin.target;
		if (!dest) {
			new Notice(T("Este portal / escalera no tiene destino.", "This portal / stairs has no destination."));
			return;
		}
		map.flyTo(toLatLng(dest), target ? map.getZoom() : pin.target!.zoom, { duration: 0.9 });
		// Pulso visual en el destino, como en el editor.
		const ring = L.circleMarker(toLatLng(dest), { radius: 30, className: "strakes-pulse", interactive: false }).addTo(map);
		window.setTimeout(() => ring.remove(), 2200);
	}

	/**
	 * Mapa sin tamaño guardado (p. ej. editado a mano o aún no abierto en el editor): se mide
	 * la imagen aquí. El tamaño queda solo en memoria, porque el embed nunca escribe el archivo.
	 */
	private measuring = false;
	private measureImage(data: MapData, src: string): void {
		if (this.measuring) return;
		this.measuring = true;
		loadImageSize(src)
			.then(({ width, height }) => {
				this.measuring = false;
				if (this.data !== data || !width || !height) return;
				data.width = width;
				data.height = height;
				this.render();
			})
			.catch(() => {
				this.measuring = false;
			});
	}

	/** Encuadre inicial: el pin indicado en #subpath o el mapa completo. */
	private initialView(): void {
		const data = this.data;
		const map = this.map;
		if (!data || !map || !data.width || !data.height) return;
		this.fitted = true;
		map.invalidateSize();
		const wanted = safeDecode(this.subpath.replace(/^#/, "")).trim().toLowerCase();
		const pin = wanted ? data.pins.find((p) => p.name.trim().toLowerCase() === wanted) : undefined;
		if (pin) {
			map.fitBounds(mapBounds(data), { animate: false });
			map.setView(toLatLng(pin), Math.min(map.getZoom() + 2, map.getMaxZoom()), { animate: false });
		} else {
			if (wanted) new Notice(T(`Mapa ${this.file.basename}: no hay ningún marcador llamado «${wanted}».`, `Map ${this.file.basename}: there's no marker named "${wanted}".`));
			this.fitWhole(false);
		}
	}
}

/** decodeURIComponent sin lanzar con un «%» suelto (p. ej. ![[mapa.smap#50%]]): se usa el texto tal cual. */
function safeDecode(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}
