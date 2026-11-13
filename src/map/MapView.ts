import * as L from "leaflet";
import { Keymap, Menu, Notice, Scope, setIcon, setTooltip, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { numberLocale, T } from "../i18n";
import type StrakesTTRPG from "../main";
import { uid, VIEW_TYPE_MAP } from "../types";
import { confirmDialog, loadImageSize, promptText } from "../ui/modals";
import { curvePoint, Pt } from "./geometry";
import { nodeMarker, PIN_TOOLTIP_OPTIONS, pinIcon, pinTooltipText, segmentLabel } from "./render";
import { PinHoverParent } from "./hover";
import { linktextOf, parseWikilink, resolveWikilink } from "./links";
import {
	bendsOf,
	isItemVisible,
	legsTime,
	deleteNode,
	distanceTime,
	displayDistance,
	formatTotal,
	KM_PER_MILE,
	formatHours,
	formatTravelTime,
	MapData,
	MapPin,
	MapRoute,
	nearestSegment,
	nodeMap,
	normalizeMap,
	Pace,
	PACES,
	parseDistanceInput,
	PathResult,
	pathGeometry,
	DEFAULT_ICON_COLOR,
	DEFAULT_PIN_COLOR,
	pixelDistance,
	pruneNodes,
	reverseRoute,
	ROUTE_COLORS,
	routePath,
	routeTime,
	routeTotal,
	RouteNode,
	segmentControlPoints,
	shortestPath,
	splitSegment,
} from "./mapData";
import { editSegmentDialog, MapPropsModal, PinModal, RouteModal } from "./mapModals";

type Mode = "navigate" | "pin" | "route" | "measure" | "calibrate" | "pick-target";

function modeHint(mode: Mode): string {
	switch (mode) {
		case "navigate":
			return "";
		case "pin":
			return T("Clic en el mapa para colocar un marcador. Esc para salir.", "Click the map to place a marker. Esc to exit.");
		case "route":
			return T(
				"Clic: añadir nodo (clic en un nodo existente lo conecta). Mayús+clic: punto de curva, sin crear nodo. Enter o Esc para terminar.",
				"Click: add a node (clicking an existing node connects it). Shift+click: curve point, without creating a node. Enter or Esc to finish.",
			);
		case "measure":
			return T(
				"Clic en dos nodos para calcular la distancia por las rutas visibles (o dos puntos si el mapa tiene escala).",
				"Click two nodes to calculate the distance along the visible routes (or two points if the map has a scale).",
			);
		case "calibrate":
			return T("Clic en dos puntos cuya distancia real conozcas.", "Click two points whose real distance you know.");
		case "pick-target":
			return T(
				"Clic en el mapa (o en otro marcador) para fijar el destino del portal / escalera; se guarda también el zoom actual.",
				"Click the map (or another marker) to set the portal / stairs destination; the current zoom is saved too.",
			);
	}
}

/** Vista de los archivos .smap: mapa de imagen con pines, capas, rutas y portales. */
export class MapView extends TextFileView {
	mapData: MapData | null = null;

	private map: L.Map | null = null;
	private imageOverlay: L.ImageOverlay | null = null;
	private loadedImage = "";
	private groups = new Map<string, { pins: L.LayerGroup; routes: L.LayerGroup }>();
	private routeLines = new Map<string, L.Polyline>();
	private overlay: L.LayerGroup | null = null; // medición y efectos
	private draftLayer: L.LayerGroup | null = null; // vista previa al dibujar rutas
	private pendingBends: Pt[] = [];

	private mode: Mode = "navigate";
	private editing = false;
	private showLabels = false;
	/** Capa activa: si es una capa del usuario, los pines y rutas nuevos van ahí. */
	private currentLayerId: string | null = null;
	private selectedRouteId: string | null = null;
	private pinFilter = "";

	private activeRouteId: string | null = null;
	private activeRouteIsNew = false;
	/** true = los nodos nuevos se añaden al principio de la ruta («Extender desde el inicio»). */
	private extendAtStart = false;
	private measureFrom: { pt: Pt; nodeId?: string } | null = null;
	private measureText = "";
	/** Última medición, para recalcular el tiempo si se cambia el paso. */
	private lastMeasure: { kind: "path"; res: PathResult } | { kind: "line"; distance: number } | null = null;
	private calibrateFrom: Pt | null = null;
	private pickTargetPin: MapPin | null = null;
	private noteLeaf: WorkspaceLeaf | null = null;
	private pinHover = new PinHoverParent(() => this.plugin.settings.pinPreviewTitle);
	private needsFit = true;

	private toolbarEl!: HTMLElement;
	private mapEl!: HTMLElement;
	private panelEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private panelOpen = true;
	/**
	 * Texto original de un .smap que no se pudo leer (JSON no válido o que no es un objeto).
	 * Mientras no es null, el mapa no se muestra ni se edita y getViewData() devuelve este
	 * texto tal cual: así ningún guardado de Obsidian puede sobrescribir el archivo dañado.
	 */
	private brokenText: string | null = null;
	/** Aviso de imagen no encontrada. Va en la barra de estado junto a las demás indicaciones (ver renderStatus). */
	private imageWarning = "";

	constructor(leaf: WorkspaceLeaf, private plugin: StrakesTTRPG) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => {
			this.escape();
			return false;
		});
		this.scope.register([], "Enter", () => {
			if (this.mode !== "route") return true;
			this.finishRoute();
			return false;
		});
	}

	getViewType(): string {
		return VIEW_TYPE_MAP;
	}
	getDisplayText(): string {
		return this.file?.basename ?? T("Mapa", "Map");
	}
	getIcon(): string {
		return "map";
	}

	// ---------- Ciclo de vida ----------

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("strakes-map-view");
		// Iconos SVG importados o recargados: redibujar los pines.
		this.registerEvent(this.plugin.events.on("icons", () => this.renderAll()));
		this.toolbarEl = root.createDiv("strakes-map-toolbar");
		const body = root.createDiv("strakes-map-body");
		this.mapEl = body.createDiv("strakes-map-canvas");
		this.panelEl = body.createDiv("strakes-map-panel");
		this.errorEl = body.createDiv("strakes-map-error");
		this.errorEl.hide();
		this.statusEl = root.createDiv("strakes-map-status");

		this.addAction("settings", T("Propiedades del mapa", "Map properties"), () => this.openProps());
	}

	async onClose(): Promise<void> {
		this.map?.remove();
		this.map = null;
	}

	onResize(): void {
		this.map?.invalidateSize();
	}

	getViewData(): string {
		if (this.brokenText !== null) return this.brokenText;
		return JSON.stringify(this.mapData ?? {}, null, "\t");
	}

	setViewData(text: string, clear: boolean): void {
		let raw: unknown = {};
		let problem: string | null = null;
		try {
			raw = text.trim() ? JSON.parse(text) : {};
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) problem = T("No contiene un objeto JSON.", "It doesn't contain a JSON object.");
		} catch (e) {
			problem = e instanceof Error ? e.message : String(e);
		}
		if (problem !== null) {
			this.showBroken(text, problem);
			return;
		}
		this.hideBroken();
		this.mapData = normalizeMap(raw);
		if (clear) {
			this.needsFit = true;
			this.mode = "navigate";
			this.activeRouteId = null;
			this.measureText = "";
		}
		// Archivo cargado (al abrirlo o porque cambió fuera del editor): historial nuevo.
		this.undoStack = [];
		this.redoStack = [];
		this.lastSnapshot = JSON.stringify(this.mapData);
		this.updateHistoryButtons();
		// Si la capa activa ya no existe, lo nuevo se crea sin capa.
		if (this.currentLayerId && !this.mapData.layers.some((l) => l.id === this.currentLayerId)) this.currentLayerId = null;
		void this.refresh();
	}

	/**
	 * Archivo dañado: en lugar del mapa, un aviso. Nada se edita ni se guarda, y el
	 * historial de deshacer se vacía para que no pueda restaurar un mapa anterior encima.
	 */
	private showBroken(text: string, problem: string): void {
		this.brokenText = text;
		this.mapData = null;
		this.undoStack = [];
		this.redoStack = [];
		this.lastSnapshot = null;
		this.activeRouteId = null;
		this.mode = "navigate";
		this.toolbarEl.hide();
		this.mapEl.hide();
		this.panelEl.hide();
		this.statusEl.hide();
		this.errorEl.empty();
		this.errorEl.createEl("h3", { text: T("No se puede abrir este mapa", "This map can't be opened") });
		this.errorEl.createEl("p", {
			text: T(
				"El archivo no es JSON válido. No se ha modificado y el plugin no lo va a sobrescribir: corrígelo con un editor de texto o restáuralo desde una copia de seguridad. En cuanto el archivo vuelva a ser válido, el mapa se abrirá solo.",
				"The file isn't valid JSON. It hasn't been changed and the plugin won't overwrite it: fix it with a text editor or restore it from a backup. As soon as the file is valid again, the map will open on its own.",
			),
		});
		this.errorEl.createEl("p", { cls: "strakes-map-error-detail", text: problem });
		this.errorEl.show();
		new Notice(T("El archivo del mapa no es JSON válido.", "The map file isn't valid JSON."));
		console.error(`Strakes TTRPG: invalid map file "${this.file?.path ?? ""}": ${problem}`);
	}

	private hideBroken(): void {
		if (this.brokenText === null) return;
		this.brokenText = null;
		this.errorEl.hide();
		this.errorEl.empty();
		this.toolbarEl.show();
		this.mapEl.show();
		this.panelEl.show();
		this.needsFit = true;
		window.setTimeout(() => this.map?.invalidateSize(), 50);
	}

	clear(): void {
		this.hideBroken();
		this.mapData = null;
		this.groups.forEach((g) => {
			g.pins.remove();
			g.routes.remove();
		});
		this.groups.clear();
	}

	/**
	 * Guarda el mapa y apunta el cambio en el historial de deshacer: cada guardado con
	 * cambios reales es un paso (colocar, mover o borrar marcadores, nodos, curvas, capas…).
	 */
	private persist(): void {
		if (this.brokenText !== null || !this.mapData) return;
		const now = JSON.stringify(this.mapData);
		if (this.lastSnapshot !== null && now !== this.lastSnapshot) {
			this.undoStack.push(this.lastSnapshot);
			if (this.undoStack.length > MapView.HISTORY_LIMIT) this.undoStack.shift();
			this.redoStack = [];
		}
		this.lastSnapshot = now;
		this.requestSave();
		this.updateHistoryButtons();
	}

	// ---------- Deshacer / rehacer ----------

	private static readonly HISTORY_LIMIT = 100;
	private undoStack: string[] = [];
	private redoStack: string[] = [];
	/** Estado del mapa tras el último guardado (base para el siguiente paso del historial). */
	private lastSnapshot: string | null = null;
	private undoBtn: HTMLElement | null = null;
	private redoBtn: HTMLElement | null = null;

	private undo(): void {
		const prev = this.undoStack.pop();
		if (prev === undefined || this.lastSnapshot === null) return;
		this.redoStack.push(this.lastSnapshot);
		this.restoreSnapshot(prev);
	}

	private redo(): void {
		const next = this.redoStack.pop();
		if (next === undefined || this.lastSnapshot === null) return;
		this.undoStack.push(this.lastSnapshot);
		this.restoreSnapshot(next);
	}

	private restoreSnapshot(snapshot: string): void {
		this.mapData = normalizeMap(JSON.parse(snapshot));
		this.lastSnapshot = snapshot;
		// Lo que se estaba haciendo puede haber dejado de existir.
		if (this.activeRouteId && !this.mapData.routes.some((r) => r.id === this.activeRouteId)) {
			this.activeRouteId = null;
			this.pendingBends = [];
			if (this.mode === "route") this.mode = "navigate";
		}
		if (this.selectedRouteId && !this.mapData.routes.some((r) => r.id === this.selectedRouteId)) this.selectedRouteId = null;
		if (this.currentLayerId && !this.mapData.layers.some((l) => l.id === this.currentLayerId)) this.currentLayerId = null;
		this.measureFrom = null;
		this.lastMeasure = null;
		this.measureText = "";
		this.overlay?.clearLayers();
		this.requestSave();
		this.updateHistoryButtons();
		void this.refresh();
	}

	private updateHistoryButtons(): void {
		const set = (b: HTMLElement | null, on: boolean) => {
			if (!b) return;
			b.toggleClass("is-disabled", !on);
			(b as HTMLButtonElement).disabled = !on;
		};
		set(this.undoBtn, this.undoStack.length > 0);
		set(this.redoBtn, this.redoStack.length > 0);
	}

	// ---------- Mapa base ----------

	private ensureMap(): L.Map {
		if (this.map) return this.map;
		const map = L.map(this.mapEl, {
			crs: L.CRS.Simple,
			minZoom: -6,
			maxZoom: 5,
			zoomSnap: 0.25,
			zoomDelta: 0.5,
			wheelPxPerZoomLevel: 100,
			attributionControl: false,
			boxZoom: false,
		});
		map.on("click", (e: L.LeafletMouseEvent) => this.onMapClick(e));
		map.on("contextmenu", (e: L.LeafletMouseEvent) => this.onMapContextMenu(e));
		this.overlay = L.layerGroup().addTo(map);
		this.draftLayer = L.layerGroup().addTo(map);
		this.map = map;
		// El contenedor puede tener tamaño 0 al abrir la pestaña.
		window.setTimeout(() => map.invalidateSize(), 50);
		return map;
	}

	private async refresh(): Promise<void> {
		const data = this.mapData;
		if (!data) return;
		const map = this.ensureMap();

		if (data.image !== this.loadedImage || !this.imageOverlay) {
			this.imageOverlay?.remove();
			this.imageOverlay = null;
			this.loadedImage = data.image;
			const file = this.app.vault.getAbstractFileByPath(data.image);
			if (!(file instanceof TFile)) {
				this.imageWarning = T(
					`⚠ Imagen no encontrada: "${data.image}". Ábrela en Propiedades del mapa (⚙).`,
					`⚠ Image not found: "${data.image}". Open it in Map properties (⚙).`,
				);
			} else {
				this.imageWarning = "";
				const src = this.app.vault.getResourcePath(file);
				if (!data.width || !data.height) {
					try {
						const size = await loadImageSize(src);
						data.width = size.width;
						data.height = size.height;
						// Dato técnico, no un cambio del usuario: se guarda sin pasar por el historial.
						this.lastSnapshot = JSON.stringify(this.mapData);
						this.requestSave();
					} catch {
						new Notice(T("No se pudo leer el tamaño de la imagen.", "Couldn't read the image size."));
						return;
					}
				}
				this.imageOverlay = L.imageOverlay(src, this.bounds(), { interactive: false }).addTo(map);
				this.imageOverlay.bringToBack();
				map.setMaxBounds(this.bounds().pad(0.5));
			}
		}
		if (this.needsFit && data.width && data.height) {
			this.needsFit = false;
			map.invalidateSize();
			map.fitBounds(this.bounds());
		}
		this.renderAll();
	}

	private bounds(): L.LatLngBounds {
		const d = this.mapData!;
		return L.latLngBounds([0, 0], [d.height, d.width]);
	}

	private ll(p: Pt): L.LatLng {
		return L.latLng(p.y, p.x);
	}

	private pt(ll: L.LatLng): Pt {
		return { x: ll.lng, y: ll.lat };
	}

	// ---------- Render ----------

	/** Vuelve a pintar los textos de distancia tras cambiar la unidad para mostrar. */
	refreshUnits(): void {
		if (!this.mapData) return;
		if (this.lastMeasure) this.measureText = this.describeMeasure();
		this.renderAll();
	}

	private renderAll(): void {
		const data = this.mapData;
		const map = this.map;
		if (!data || !map) return;

		for (const g of this.groups.values()) {
			g.pins.remove();
			g.routes.remove();
		}
		this.groups.clear();
		this.routeLines.clear();

		// Un grupo por capa más uno para «sin capa» (clave ""). Cada grupo se muestra
		// según el interruptor de su tipo (Pines / Rutas) y la visibilidad de la capa.
		for (const layerId of ["", ...data.layers.map((l) => l.id)]) {
			const g = { pins: L.layerGroup(), routes: L.layerGroup() };
			this.groups.set(layerId, g);
			if (isItemVisible(data, "routes", layerId || null)) g.routes.addTo(map);
			if (isItemVisible(data, "pins", layerId || null)) g.pins.addTo(map);
		}

		const nodes = nodeMap(data);
		for (const route of data.routes) this.renderRoute(route, nodes);
		for (const pin of data.pins) this.renderPin(pin);

		this.renderDraft();
		this.renderToolbar();
		this.renderPanel();
		this.renderStatus();
		this.mapEl.toggleClass("is-editing", this.editing);
		this.mapEl.dataset.mode = this.mode;
	}

	private renderPin(pin: MapPin): void {
		const g = this.groups.get(pin.layerId ?? "");
		if (!g) return;
		const marker = L.marker(this.ll(pin), {
			icon: pinIcon(pin),
			draggable: this.editing,
			keyboard: false,
			riseOnHover: true,
		});
		marker.bindTooltip(pinTooltipText(pin), { ...PIN_TOOLTIP_OPTIONS, permanent: this.showLabels });
		marker.on("click", (e: L.LeafletMouseEvent) => this.onPinClick(pin, e.originalEvent));
		marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stop(e.originalEvent);
			this.pinMenu(pin, e.originalEvent);
		});
		marker.on("dragend", () => {
			const p = this.pt(marker.getLatLng());
			pin.x = p.x;
			pin.y = p.y;
			this.persist();
		});
		marker.on("mouseover", (e: L.LeafletMouseEvent) =>
			this.pinHover.show(this.app, pin, e.originalEvent, marker.getElement(), this.file?.path ?? ""),
		);
		g.pins.addLayer(marker);
	}

	private renderRoute(route: MapRoute, nodes: Map<string, RouteNode>): void {
		const data = this.mapData!;
		const g = this.groups.get(route.layerId ?? "");
		if (!g) return;
		const latlngs = routePath(route, nodes).map((p) => this.ll(p));
		const selected = this.selectedRouteId === route.id || this.activeRouteId === route.id;
		const line = L.polyline(latlngs, {
			color: route.color || ROUTE_COLORS[0],
			weight: selected ? 6 : 4,
			opacity: 0.9,
			bubblingMouseEvents: false,
			className: "strakes-route-line",
		});
		const total = routeTotal(data, route, nodes);
		// Tooltip: nombre, distancia total y tiempo al paso elegido en la herramienta Medir.
		const pace = this.plugin.settings.travelPace;
		const time = routeTime(data, route, pace);
		const paceName = PACES[pace].label.toLowerCase();
		const timeTxt =
			time.unknown === route.segments.length
				? ""
				: T(
						` · ${formatHours(time.hours)} a paso ${paceName}${time.unknown ? " (incompleto)" : ""}`,
						` · ${formatHours(time.hours)} at ${paceName} pace${time.unknown ? " (incomplete)" : ""}`,
					);
		line.bindTooltip(`${route.name} · ${formatTotal(total, data.unit, this.plugin.settings.displayUnit)}${timeTxt}`, {
			sticky: true,
			className: "strakes-map-tooltip",
		});
		line.on("click", (e: L.LeafletMouseEvent) => {
			if (this.mode === "pin" || this.mode === "calibrate" || this.mode === "pick-target" || this.mode === "measure") {
				this.onMapClick(e);
				return;
			}
			if (this.mode === "route") return;
			this.selectedRouteId = this.selectedRouteId === route.id ? null : route.id;
			this.renderAll();
		});
		line.on("contextmenu", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stop(e.originalEvent);
			this.routeMenu(route, e.originalEvent, this.pt(e.latlng));
		});
		g.routes.addLayer(line);
		this.routeLines.set(route.id, line);

		// Etiquetas de distancia en el centro de cada tramo.
		if (data.showDistances) {
			for (let i = 0; i < route.nodeIds.length - 1; i++) {
				// Etiqueta «número · ruta» (el número es el del diálogo de la ruta). Si la ruta muestra
				// sus puntos de curva, la etiqueta sube un poco para no tapar el punto del centro.
				const withHandles = this.editing && this.selectedRouteId === route.id;
				const label = segmentLabel(route, i, nodes, true, withHandles);
				if (!label) continue;
				label.on("click", () => void this.editSegment(route, i));
				g.routes.addLayer(label);
			}
		}

		// Nodos (arrastrables en modo edición).
		route.nodeIds.forEach((id) => {
			const n = nodes.get(id);
			if (!n) return;
			const marker = nodeMarker(n, route.color, { draggable: this.editing, selected: this.measureFrom?.nodeId === id });
			marker.on("click", (e: L.LeafletMouseEvent) => this.onNodeClick(n, e));
			marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
				L.DomEvent.stop(e.originalEvent);
				this.nodeMenu(n, e.originalEvent);
			});
			marker.on("drag", () => {
				const p = this.pt(marker.getLatLng());
				n.x = p.x;
				n.y = p.y;
				for (const r of data.routes) if (r.nodeIds.includes(n.id)) this.redrawRouteLine(r, nodes);
			});
			marker.on("dragend", () => {
				this.persist();
				this.renderAll();
			});
			g.routes.addLayer(marker);
		});

		// Puntos de curva: solo en edición y para la ruta seleccionada (para no saturar el mapa).
		if (this.editing && this.selectedRouteId === route.id) this.renderBendHandles(route, nodes, g.routes);
	}

	private redrawRouteLine(route: MapRoute, nodes: Map<string, RouteNode>): void {
		this.routeLines.get(route.id)?.setLatLngs(routePath(route, nodes).map((p) => this.ll(p)));
	}

	/**
	 * Tiradores para dar forma a la ruta sin crear nodos:
	 *  - ● puntos de curva existentes: se arrastran; doble clic o clic derecho para quitarlos.
	 *  - ◦ puntos fantasma a mitad de cada tramo: al arrastrarlos se crea un punto de curva nuevo.
	 */
	private renderBendHandles(route: MapRoute, nodes: Map<string, RouteNode>, group: L.LayerGroup): void {
		const handleIcon = (cls: string) => L.divIcon({ className: cls, html: "", iconSize: [12, 12], iconAnchor: [6, 6] });
		const setColor = (m: L.Marker) => m.on("add", () => m.getElement()?.style.setProperty("--route-color", route.color));
		const finish = () => {
			this.persist();
			this.renderAll();
		};

		for (let i = 0; i < route.nodeIds.length - 1; i++) {
			const ctrl = segmentControlPoints(route, i, nodes);
			if (!ctrl) continue;
			const bends = bendsOf(route, i);

			bends.forEach((b, j) => {
				const m = L.marker(this.ll(b), { icon: handleIcon("strakes-bend"), draggable: true, keyboard: false });
				setColor(m);
				m.bindTooltip(T("Punto de curva · doble clic para quitar", "Curve point · double-click to remove"), { direction: "top", offset: [0, -8], className: "strakes-map-tooltip" });
				m.on("drag", () => {
					bends[j] = this.pt(m.getLatLng());
					this.redrawRouteLine(route, nodes);
				});
				m.on("dragend", finish);
				const remove = () => {
					bends.splice(j, 1);
					finish();
				};
				m.on("dblclick", (e: L.LeafletMouseEvent) => {
					L.DomEvent.stop(e.originalEvent);
					remove();
				});
				m.on("contextmenu", (e: L.LeafletMouseEvent) => {
					L.DomEvent.stop(e.originalEvent);
					const menu = new Menu();
					menu.addItem((it) => it.setTitle(T("Quitar punto de curva", "Remove curve point")).setIcon("x").onClick(remove));
					menu.addItem((it) =>
						it
							.setTitle(T("Convertir en nodo", "Convert to node"))
							.setIcon("circle-dot")
							.onClick(() => {
								bends.splice(j, 1);
								splitSegment(this.mapData!, route, i, b);
								finish();
							}),
					);
					menu.showAtMouseEvent(e.originalEvent);
				});
				group.addLayer(m);
			});

			for (let k = 0; k < ctrl.length - 1; k++) {
				// Fantasma en el punto medio de la curva visible entre dos puntos de control.
				const mid =
					route.smooth === false
						? { x: (ctrl[k].x + ctrl[k + 1].x) / 2, y: (ctrl[k].y + ctrl[k + 1].y) / 2 }
						: curvePoint(ctrl, k, 0.5);
				const ghost = L.marker(this.ll(mid), { icon: handleIcon("strakes-bend-ghost"), draggable: true, keyboard: false });
				setColor(ghost);
				ghost.bindTooltip(T("Arrastra para curvar", "Drag to curve"), { direction: "top", offset: [0, -8], className: "strakes-map-tooltip" });
				let inserted = false;
				ghost.on("dragstart", () => {
					bends.splice(k, 0, this.pt(ghost.getLatLng()));
					inserted = true;
				});
				ghost.on("drag", () => {
					if (!inserted) return;
					bends[k] = this.pt(ghost.getLatLng());
					this.redrawRouteLine(route, nodes);
				});
				ghost.on("dragend", finish);
				group.addLayer(ghost);
			}
		}
	}

	// ---------- Barra de herramientas, panel y estado ----------

	private renderToolbar(): void {
		const tb = this.toolbarEl;
		tb.empty();
		const tool = (mode: Mode, icon: string, label: string) => {
			const b = this.toolButton(tb, icon, label, () => this.setMode(this.mode === mode ? "navigate" : mode));
			b.toggleClass("is-active", this.mode === mode || (mode === "route" && this.mode === "route"));
		};
		// Deshacer / rehacer los cambios del mapa.
		this.undoBtn = this.toolButton(tb, "undo-2", T("Deshacer", "Undo"), () => this.undo());
		this.redoBtn = this.toolButton(tb, "redo-2", T("Rehacer", "Redo"), () => this.redo());
		this.updateHistoryButtons();
		tb.createDiv("strakes-toolbar-sep");
		tool("navigate", "hand", T("Navegar", "Navigate"));
		tool("pin", "map-pin", T("Añadir marcador", "Add marker"));
		tool("route", "route", T("Crear ruta", "Create route"));
		tool("measure", "ruler", T("Medir distancia y tiempo de viaje", "Measure distance and travel time"));
		if (this.mode === "measure") {
			// Paso del viaje: cambia el tiempo calculado (se recuerda entre sesiones).
			const seg = tb.createDiv("strakes-segmented strakes-pace");
			for (const pace of ["slow", "normal", "fast"] as Pace[]) {
				const b = seg.createEl("button", { text: PACES[pace].label });
				b.toggleClass("is-active", this.plugin.settings.travelPace === pace);
				const perDay = PACES[pace].hoursPerDay.toLocaleString(numberLocale());
				const kmh = this.plugin.settings.displayUnit === "km";
				const speed = kmh
					? `${(PACES[pace].mph * KM_PER_MILE).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} km/h`
					: T(`${PACES[pace].mph} millas/h`, `${PACES[pace].mph} miles/h`);
				setTooltip(b, T(`${speed} · ${perDay} h de marcha al día`, `${speed} · ${perDay} h of travel per day`));
				b.onclick = () => {
					this.plugin.settings.travelPace = pace;
					void this.plugin.saveSettings();
					if (this.lastMeasure) this.measureText = this.describeMeasure();
					this.renderAll();
				};
			}
		}
		if (this.mode === "route") {
			const done = this.toolButton(tb, "check", T("Terminar ruta (Enter)", "Finish route (Enter)"), () => this.finishRoute());
			done.addClass("mod-cta");
		}
		tb.createDiv("strakes-toolbar-sep");
		const lockTip = this.editing
			? T("Edición activa: arrastra marcadores y nodos", "Editing on: drag markers and nodes")
			: T("Bloqueado (activar edición)", "Locked (turn on editing)");
		this.toolButton(tb, this.editing ? "unlock" : "lock", lockTip, () => {
			this.editing = !this.editing;
			this.renderAll();
		}).toggleClass("is-active", this.editing);
		this.toolButton(tb, "tag", T("Mostrar nombres de los marcadores", "Show marker names"), () => {
			this.showLabels = !this.showLabels;
			this.renderAll();
		}).toggleClass("is-active", this.showLabels);
		this.toolButton(tb, "milestone", T("Mostrar etiquetas de los tramos (número y ruta)", "Show segment labels (number and route)"), () => {
			if (!this.mapData) return;
			this.mapData.showDistances = !this.mapData.showDistances;
			this.persist();
			this.renderAll();
		}).toggleClass("is-active", !!this.mapData?.showDistances);
		this.toolButton(tb, "maximize", T("Encuadrar todo el mapa", "Fit the whole map"), () => this.map?.flyToBounds(this.bounds(), { duration: 0.5 }));
		tb.createDiv("strakes-toolbar-spacer");
		this.toolButton(tb, "panel-right", T("Mostrar/ocultar panel", "Show/hide panel"), () => {
			this.panelOpen = !this.panelOpen;
			this.renderPanel();
			window.setTimeout(() => this.map?.invalidateSize(), 50);
		}).toggleClass("is-active", this.panelOpen);
	}

	private toolButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const b = parent.createEl("button", { cls: "clickable-icon strakes-tool" });
		setIcon(b, icon);
		if (!b.querySelector("svg")) b.setText(label.slice(0, 2));
		setTooltip(b, label);
		b.onclick = onClick;
		return b;
	}

	private renderPanel(): void {
		const panel = this.panelEl;
		const data = this.mapData;
		panel.empty();
		panel.toggle(this.panelOpen);
		if (!data || !this.panelOpen) return;

		// Mostrar: interruptores fijos por tipo, independientes de las capas.
		const showSec = this.section(panel, T("Mostrar", "Show"));
		const typeRow = (type: "pins" | "routes", icon: string, label: string, count: number) => {
			const row = showSec.createDiv("strakes-panel-row strakes-type-row");
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = type === "pins" ? data.showPins : data.showRoutes;
			cb.onchange = () => {
				if (type === "pins") data.showPins = cb.checked;
				else data.showRoutes = cb.checked;
				this.persist();
				this.renderAll();
			};
			setIcon(row.createSpan("strakes-layer-kind"), icon);
			row.createDiv({ cls: "strakes-panel-name", text: label });
			row.createDiv({ cls: "strakes-panel-meta", text: String(count) });
			row.onclick = (e) => {
				if (e.target !== cb) cb.click();
			};
		};
		typeRow("pins", "map-pin", T("Marcadores", "Markers"), data.pins.length);
		typeRow("routes", "route", T("Rutas", "Routes"), data.routes.length);

		// Capas del usuario: cada pin o ruta puede estar en una o en ninguna.
		const layersSec = this.collapsibleSection(panel, "layers", T("Capas", "Layers"), data.layers.length, {
			icon: "plus",
			tip: T("Nueva capa", "New layer"),
			onClick: () => void this.addLayer(),
		});
		if (!data.layers.length)
			layersSec.createDiv({ cls: "strakes-panel-meta strakes-panel-empty", text: T("Sin capas. Crea una con + para agrupar marcadores y rutas.", "No layers. Create one with + to group markers and routes.") });
		for (const layer of data.layers) {
			const row = layersSec.createDiv("strakes-panel-row strakes-layer-row");
			row.toggleClass("is-current", layer.id === this.currentLayerId);
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = layer.visible;
			cb.onchange = () => {
				layer.visible = cb.checked;
				this.persist();
				this.renderAll();
			};
			const nPins = data.pins.filter((p) => p.layerId === layer.id).length;
			const nRoutes = data.routes.filter((r) => r.layerId === layer.id).length;
			const name = row.createDiv({ cls: "strakes-panel-name", text: layer.name });
			setTooltip(name, T("Clic para activarla: los marcadores y rutas nuevos se crearán en esta capa", "Click to make it active: new markers and routes will be created on this layer"));
			name.onclick = () => {
				this.currentLayerId = this.currentLayerId === layer.id ? null : layer.id;
				this.renderPanel();
			};
			row.createDiv({ cls: "strakes-panel-meta", text: `${nPins}📍 ${nRoutes}〰` });
			const more = row.createEl("button", { cls: "clickable-icon" });
			setIcon(more, "more-horizontal");
			more.onclick = (evt) => this.layerMenu(layer.id, evt);
		}

		// Rutas
		if (data.routes.length) {
			const routesSec = this.collapsibleSection(panel, "routes", T("Rutas", "Routes"), data.routes.length);
			const nodes = nodeMap(data);
			for (const r of data.routes) {
				const row = routesSec.createDiv("strakes-panel-row");
				row.toggleClass("is-current", r.id === this.selectedRouteId);
				const sw = row.createDiv("strakes-swatch");
				sw.style.background = r.color;
				row.createDiv({ cls: "strakes-panel-name", text: r.name });
				row.createDiv({ cls: "strakes-panel-meta", text: formatTotal(routeTotal(data, r, nodes), data.unit, this.plugin.settings.displayUnit) });
				row.onclick = () => {
					this.selectedRouteId = r.id;
					const line = this.routeLines.get(r.id);
					if (line && line.getLatLngs().length) this.map?.flyToBounds(line.getBounds().pad(0.3), { duration: 0.5 });
					this.renderAll();
				};
				row.oncontextmenu = (evt) => this.routeMenu(r, evt);
			}
		}

		// Pines
		if (data.pins.length) {
			const pinsSec = this.collapsibleSection(panel, "pins", T("Marcadores", "Markers"), data.pins.length);
			const filter = pinsSec.createEl("input", { type: "search", cls: "strakes-panel-filter", attr: { placeholder: T("Filtrar…", "Filter…") } });
			filter.value = this.pinFilter;
			const list = pinsSec.createDiv();
			const renderList = () => {
				list.empty();
				const q = this.pinFilter.toLowerCase();
				for (const p of data.pins.filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))) {
					const row = list.createDiv("strakes-panel-row");
					const sw = row.createDiv("strakes-swatch is-round");
					sw.style.background = p.color;
					row.createDiv({ cls: "strakes-panel-name", text: p.name });
					row.createDiv({ cls: "strakes-panel-meta", text: data.layers.find((l) => l.id === p.layerId)?.name ?? "" });
					row.onclick = () => this.map?.flyTo(this.ll(p), Math.max(this.map.getZoom(), 0), { duration: 0.6 });
					row.oncontextmenu = (evt) => this.pinMenu(p, evt);
				}
			};
			filter.oninput = () => {
				this.pinFilter = filter.value;
				renderList();
			};
			renderList();
		}

		// Escala
		const scaleSec = this.section(panel, T("Escala", "Scale"), "scale", T("Calibrar escala", "Calibrate scale"), () => this.setMode("calibrate"));
		scaleSec.createDiv({
			cls: "strakes-panel-meta",
			text: data.scale
				? `100 px = ${displayDistance(data.scale * 100, data.unit, this.plugin.settings.displayUnit)}`
				: T("Sin escala: escribe la distancia de cada tramo (clic en su etiqueta).", "No scale: enter the distance of each segment (click its label)."),
		});
	}

	private section(parent: HTMLElement, title: string, icon?: string, tip?: string, onClick?: () => void): HTMLElement {
		const sec = parent.createDiv("strakes-panel-section");
		const head = sec.createDiv("strakes-panel-head");
		head.createSpan({ text: title });
		if (icon && onClick) {
			const b = head.createEl("button", { cls: "clickable-icon" });
			setIcon(b, icon);
			if (tip) setTooltip(b, tip);
			b.onclick = onClick;
		}
		return sec;
	}

	/**
	 * Sección plegable del panel: clic en el título para plegar/desplegar.
	 * Muestra el número de elementos junto al título. El estado se recuerda
	 * (ajustes del plugin, común a todos los mapas). Devuelve el cuerpo de la sección.
	 */
	private collapsibleSection(
		parent: HTMLElement,
		key: string,
		title: string,
		count: number,
		action?: { icon: string; tip: string; onClick: () => void },
	): HTMLElement {
		const collapsed = this.plugin.settings.collapsedMapSections;
		const sec = parent.createDiv("strakes-panel-section is-collapsible");
		const head = sec.createDiv("strakes-panel-head");
		const toggle = head.createDiv("strakes-panel-toggle");
		const chevron = toggle.createSpan("strakes-panel-chevron");
		toggle.createSpan({ text: title });
		toggle.createSpan({ cls: "strakes-panel-count", text: String(count) });
		if (action) {
			const b = head.createEl("button", { cls: "clickable-icon" });
			setIcon(b, action.icon);
			setTooltip(b, action.tip);
			b.onclick = (e) => {
				e.stopPropagation();
				action.onClick();
			};
		}
		const body = sec.createDiv("strakes-panel-body");
		const apply = () => {
			const isCollapsed = collapsed.includes(key);
			sec.toggleClass("is-collapsed", isCollapsed);
			setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
			setTooltip(toggle, isCollapsed ? T("Desplegar", "Expand") : T("Plegar", "Collapse"));
		};
		toggle.onclick = () => {
			const i = collapsed.indexOf(key);
			if (i >= 0) collapsed.splice(i, 1);
			else collapsed.push(key);
			void this.plugin.saveSettings();
			apply();
		};
		apply();
		return body;
	}


	private renderStatus(): void {
		let editHint = "";
		if (this.editing && this.mode === "navigate")
			editHint = this.selectedRouteId
				? T(
						"Curvar: arrastra los puntos ◦ de la ruta para crear curvas; arrastra ● para moverlas; doble clic en ● para quitarla.",
						"Curving: drag the route's ◦ points to create curves; drag ● to move them; double-click ● to remove it.",
					)
				: T("Edición: arrastra marcadores y nodos. Haz clic en una ruta para curvarla.", "Editing: drag markers and nodes. Click a route to curve it.");
		const parts = [this.imageWarning, modeHint(this.mode), editHint, this.measureText].filter(Boolean);
		this.statusEl.setText(parts.join("  ·  "));
		this.statusEl.toggle(parts.length > 0);
	}

	// ---------- Modos ----------

	private setMode(mode: Mode): void {
		if (this.mode === "route" && mode !== "route") this.finishRoute();
		this.mode = mode;
		this.measureFrom = null;
		this.calibrateFrom = null;
		if (mode !== "measure") this.overlay?.clearLayers();
		if (mode !== "measure") {
			this.measureText = "";
			this.lastMeasure = null;
		}
		if (mode === "route" && !this.activeRouteId) this.activeRouteIsNew = true;
		this.map?.doubleClickZoom[mode === "navigate" ? "enable" : "disable"]();
		this.renderAll();
	}

	private escape(): void {
		if (this.mode === "route") this.finishRoute();
		else this.setMode("navigate");
	}

	private onMapClick(e: L.LeafletMouseEvent): void {
		const p = this.pt(e.latlng);
		switch (this.mode) {
			case "pin":
				this.createPin(p);
				break;
			case "route":
				if (e.originalEvent?.shiftKey) this.addPendingBend(p);
				else this.addRoutePoint(p);
				break;
			case "measure":
				this.measurePick(p);
				break;
			case "calibrate":
				void this.calibratePick(p);
				break;
			case "pick-target":
				this.setPortalTarget(p);
				break;
			default:
				if (this.selectedRouteId) {
					this.selectedRouteId = null;
					this.renderAll();
				}
		}
	}

	private onMapContextMenu(e: L.LeafletMouseEvent): void {
		const p = this.pt(e.latlng);
		const m = new Menu();
		m.addItem((i) => i.setTitle(T("Añadir marcador aquí", "Add marker here")).setIcon("map-pin").onClick(() => this.createPin(p)));
		m.addItem((i) =>
			i
				.setTitle(T("Empezar ruta aquí", "Start route here"))
				.setIcon("route")
				.onClick(() => {
					this.setMode("route");
					this.addRoutePoint(p);
				}),
		);
		m.showAtMouseEvent(e.originalEvent);
	}

	// ---------- Pines ----------

	private createPin(p: Pt): void {
		const data = this.mapData;
		if (!data) return;
		const pin: MapPin = {
			id: uid(),
			name: "",
			x: p.x,
			y: p.y,
			layerId: this.currentLayerId,
			portal: false,
			color: DEFAULT_PIN_COLOR,
			icon: "",
			iconColor: DEFAULT_ICON_COLOR,
		};
		this.openPinModal(pin, true);
	}

	private openPinModal(pin: MapPin, isNew: boolean): void {
		const data = this.mapData!;
		new PinModal(
			this.app,
			data,
			pin,
			isNew,
			this.file?.path ?? "",
			({ action, pin: edited }) => {
				const idx = data.pins.findIndex((x) => x.id === edited.id);
				if (action === "delete") {
					if (idx >= 0) data.pins.splice(idx, 1);
					for (const o of data.pins) if (o.targetPinId === edited.id) o.targetPinId = undefined;
				} else {
					if (idx >= 0) data.pins[idx] = edited;
					else data.pins.push(edited);
					if (action === "pick-target") {
						this.pickTargetPin = edited;
						this.setMode("pick-target");
					}
				}
				this.persist();
				this.renderAll();
			},
			{
				reload: () => this.plugin.reloadIcons(),
			},
		).open();
	}

	private onPinClick(pin: MapPin, evt: MouseEvent): void {
		switch (this.mode) {
			case "route":
				// Añade un nodo justo en la posición del pin.
				this.addRoutePoint({ x: pin.x, y: pin.y });
				return;
			case "pick-target":
				if (this.pickTargetPin && this.pickTargetPin.id !== pin.id) {
					this.pickTargetPin.targetPinId = pin.id;
					this.pickTargetPin.target = undefined;
					this.pickTargetPin = null;
					new Notice(T(`Portal / escalera enlazado con «${pin.name}»`, `Portal / stairs linked to "${pin.name}"`));
					this.persist();
					this.setMode("navigate");
				}
				return;
			case "measure":
			case "calibrate":
				this.onMapClick({ latlng: this.ll(pin) } as L.LeafletMouseEvent);
				return;
			case "pin":
				this.openPinModal(pin, false);
				return;
		}
		// Clic principal: abrir la nota. El portal / escalera se usa con clic derecho.
		if (pin.link) void this.openPinLink(pin, Keymap.isModEvent(evt));
		else if (this.editing) this.openPinModal(pin, false);
	}

	private goPortal(pin: MapPin): void {
		const data = this.mapData!;
		let dest: Pt | null = null;
		let zoom = this.map!.getZoom();
		if (pin.targetPinId) {
			const t = data.pins.find((x) => x.id === pin.targetPinId);
			if (t) dest = t;
		} else if (pin.target) {
			dest = pin.target;
			zoom = pin.target.zoom;
		}
		if (!dest) {
			new Notice(T("Este portal / escalera no tiene destino. Clic derecho → Editar.", "This portal / stairs has no destination. Right-click → Edit."));
			return;
		}
		this.map!.flyTo(this.ll(dest), zoom, { duration: 0.9 });
		// Pulso visual en el destino.
		const ring = L.circleMarker(this.ll(dest), { radius: 30, className: "strakes-pulse", interactive: false }).addTo(this.map!);
		window.setTimeout(() => ring.remove(), 2200);
	}

	private async openPinLink(pin: MapPin, newTab: boolean | string): Promise<void> {
		if (!pin.link) return;
		const source = this.file?.path ?? "";
		const { subpath } = parseWikilink(pin.link);
		const file = resolveWikilink(this.app, pin.link, source);
		if (!file) {
			new Notice(T(`No se encuentra la nota ${pin.link}`, `Note not found: ${pin.link}`));
			return;
		}
		if (newTab) {
			await this.app.workspace.openLinkText(linktextOf(pin.link), source, "tab");
			return;
		}
		// Reutiliza una única división junto al mapa para no llenar de pestañas.
		let alive = false;
		this.app.workspace.iterateAllLeaves((l) => {
			if (l === this.noteLeaf) alive = true;
		});
		if (!alive || !this.noteLeaf || this.noteLeaf === this.leaf) this.noteLeaf = this.app.workspace.getLeaf("split", "vertical");
		await this.noteLeaf.openFile(file, { eState: subpath ? { subpath } : undefined });
	}

	private sendPinToPlayers(pin: MapPin): void {
		if (!pin.link) return;
		const file = resolveWikilink(this.app, pin.link, this.file?.path ?? "");
		if (!file) {
			new Notice(T(`No se encuentra la nota ${pin.link}`, `Note not found: ${pin.link}`));
			return;
		}
		const { subpath } = parseWikilink(pin.link);
		void this.plugin.sendToPlayers({ kind: "note", path: file.path, subpath: subpath || undefined });
	}

	private setPortalTarget(p: Pt): void {
		const pin = this.pickTargetPin;
		if (!pin || !this.map) return;
		pin.target = { x: p.x, y: p.y, zoom: this.map.getZoom() };
		pin.targetPinId = undefined;
		this.pickTargetPin = null;
		new Notice(T(`Destino del portal / escalera «${pin.name}» guardado`, `Destination of portal / stairs "${pin.name}" saved`));
		this.persist();
		this.setMode("navigate");
	}

	private pinMenu(pin: MapPin, evt: MouseEvent): void {
		const m = new Menu();
		if (pin.portal) {
			m.addItem((i) => i.setTitle(T("Usar portal / escalera", "Use portal / stairs")).setIcon("orbit").onClick(() => this.goPortal(pin)));
			m.addSeparator();
		}
		if (pin.link) {
			m.addItem((i) => i.setTitle(T("Abrir nota", "Open note")).setIcon("file-text").onClick(() => void this.openPinLink(pin, false)));
			m.addItem((i) =>
				i
					.setTitle(T("Enviar nota a la pantalla de jugadores", "Send note to player screen"))
					.setIcon("monitor")
					.onClick(() => this.sendPinToPlayers(pin)),
			);
		}
		m.addItem((i) => i.setTitle(T("Editar…", "Edit…")).setIcon("pencil").onClick(() => this.openPinModal(pin, false)));
		this.addMoveToLayerItem(m, evt, pin);
		m.addItem((i) =>
			i
				.setTitle(T("Duplicar", "Duplicate"))
				.setIcon("copy")
				.onClick(() => {
					const copy: MapPin = { ...structuredClone(pin), id: uid(), x: pin.x + 20, y: pin.y - 20, name: T(`${pin.name} (copia)`, `${pin.name} (copy)`) };
					this.mapData!.pins.push(copy);
					this.persist();
					this.renderAll();
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar", "Delete"))
				.setIcon("trash-2")
				.onClick(() => {
					const data = this.mapData!;
					data.pins = data.pins.filter((x) => x.id !== pin.id);
					for (const o of data.pins) if (o.targetPinId === pin.id) o.targetPinId = undefined;
					this.persist();
					this.renderAll();
				}),
		);
		m.showAtMouseEvent(evt);
	}

	// ---------- Rutas ----------

	private activeRoute(): MapRoute | null {
		return this.mapData?.routes.find((r) => r.id === this.activeRouteId) ?? null;
	}

	private ensureActiveRoute(): MapRoute {
		const data = this.mapData!;
		let route = this.activeRoute();
		if (!route) {
			const layerId = this.currentLayerId;
			route = {
				id: uid(),
				name: T(`Ruta ${data.routes.length + 1}`, `Route ${data.routes.length + 1}`),
				layerId,
				color: ROUTE_COLORS[data.routes.length % ROUTE_COLORS.length],
				nodeIds: [],
				segments: [],
				bends: [],
				smooth: true,
			};
			data.routes.push(route);
			this.activeRouteId = route.id;
			this.activeRouteIsNew = true;
			this.extendAtStart = false;
			// Asegura que la capa de la ruta se vea mientras se dibuja.
			const layer = data.layers.find((l) => l.id === layerId);
			if (layer) layer.visible = true;
			data.showRoutes = true;
		}
		return route;
	}

	private addRoutePoint(p: Pt): void {
		const data = this.mapData!;
		const node: RouteNode = { id: uid(), x: p.x, y: p.y };
		data.nodes.push(node);
		this.appendNode(this.ensureActiveRoute(), node.id);
	}

	private appendNode(route: MapRoute, nodeId: string): void {
		if (this.extendAtStart) {
			// Por el inicio: el tramo nuevo va del nodo nuevo al antiguo primero, así que
			// los puntos de curva (dibujados desde el primero hacia fuera) van al revés.
			if (route.nodeIds[0] === nodeId) return;
			if (route.nodeIds.length) {
				route.segments.unshift(null);
				(route.times ??= []).unshift(null);
				route.bends = route.bends ?? [];
				route.bends.unshift([...this.pendingBends].reverse());
			}
			route.nodeIds.unshift(nodeId);
		} else {
			if (route.nodeIds[route.nodeIds.length - 1] === nodeId) return;
			if (route.nodeIds.length) {
				route.segments.push(null);
				route.times ??= [];
				while (route.times.length < route.segments.length) route.times.push(null);
				bendsOf(route, route.segments.length - 1).push(...this.pendingBends);
			}
			route.nodeIds.push(nodeId);
		}
		this.pendingBends = [];
		this.persist();
		this.renderAll();
	}

	/** Mayús+clic al dibujar: punto de curva para el tramo que se cerrará con el próximo nodo. */
	private addPendingBend(p: Pt): void {
		const route = this.activeRoute();
		if (!route || !route.nodeIds.length) {
			new Notice(T("Primero coloca el nodo inicial de la ruta (clic sin Mayús).", "First place the route's starting node (click without Shift)."));
			return;
		}
		this.pendingBends.push(p);
		this.renderDraft();
	}

	/** Vista previa discontinua desde el extremo que se está extendiendo por los puntos de curva pendientes. */
	private renderDraft(): void {
		const layer = this.draftLayer;
		if (!layer) return;
		layer.clearLayers();
		const route = this.activeRoute();
		const data = this.mapData;
		if (this.mode !== "route" || !route || !data || !this.pendingBends.length) return;
		const end = nodeMap(data).get(this.extendAtStart ? route.nodeIds[0] : route.nodeIds[route.nodeIds.length - 1]);
		if (!end) return;
		const pts = [end, ...this.pendingBends];
		L.polyline(
			pts.map((p) => this.ll(p)),
			{ color: route.color, weight: 3, dashArray: "6 6", interactive: false },
		).addTo(layer);
		for (const b of this.pendingBends)
			L.circleMarker(this.ll(b), { radius: 4, color: route.color, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(layer);
	}

	private finishRoute(openModal = true): void {
		const data = this.mapData;
		const route = this.activeRoute();
		const wasNew = this.activeRouteIsNew;
		this.activeRouteId = null;
		this.activeRouteIsNew = false;
		this.extendAtStart = false;
		// Puntos de curva sin nodo final: se descartan.
		this.pendingBends = [];
		if (this.mode === "route" && openModal) {
			this.mode = "navigate";
			this.map?.doubleClickZoom.enable();
		}
		if (data && route) {
			if (route.nodeIds.length < 2) {
				data.routes = data.routes.filter((r) => r.id !== route.id);
				pruneNodes(data);
			} else if (wasNew && openModal) {
				this.openRouteModal(route);
			}
			this.persist();
		}
		this.renderAll();
	}

	private openRouteModal(route: MapRoute): void {
		const data = this.mapData!;
		new RouteModal(this.app, data, route, (edited, deleted) => {
			if (deleted) {
				data.routes = data.routes.filter((r) => r.id !== route.id);
				pruneNodes(data);
			} else if (edited) {
				const idx = data.routes.findIndex((r) => r.id === edited.id);
				if (idx >= 0) data.routes[idx] = edited;
			}
			this.persist();
			this.renderAll();
		}).open();
	}

	private async editSegment(route: MapRoute, i: number): Promise<void> {
		if (this.mode !== "navigate" && this.mode !== "pin") return;
		const result = await editSegmentDialog(this.app, this.mapData!, route, i);
		if (!result) return;
		route.segments[i] = result.distance;
		route.times ??= [];
		while (route.times.length < route.segments.length) route.times.push(null);
		route.times[i] = result.time;
		this.persist();
		this.renderAll();
	}

	/** «Mover a capa»: submenú con «Sin capa» y las capas del usuario. */
	private addMoveToLayerItem(m: Menu, evt: MouseEvent, item: { layerId: string | null }): void {
		m.addItem((i) =>
			i
				.setTitle(T("Mover a capa", "Move to layer"))
				.setIcon("layers")
				.onClick(() => {
					const sub = new Menu();
					const choose = (id: string | null) => {
						item.layerId = id;
						this.persist();
						this.renderAll();
					};
					sub.addItem((si) => si.setTitle(T("Sin capa", "No layer")).setChecked(!item.layerId).onClick(() => choose(null)));
					if (this.mapData!.layers.length) sub.addSeparator();
					for (const l of this.mapData!.layers)
						sub.addItem((si) => si.setTitle(l.name).setChecked(l.id === item.layerId).onClick(() => choose(l.id)));
					sub.showAtMouseEvent(evt);
				}),
		);
	}

	private routeMenu(route: MapRoute, evt: MouseEvent, at?: Pt): void {
		const data = this.mapData!;
		const m = new Menu();
		m.addItem((i) => i.setTitle(T("Editar ruta y distancias…", "Edit route and distances…")).setIcon("pencil").onClick(() => this.openRouteModal(route)));
		this.addMoveToLayerItem(m, evt, route);
		const extend = (atStart: boolean) => {
			this.setMode("route");
			this.activeRouteId = route.id;
			this.activeRouteIsNew = false;
			this.extendAtStart = atStart;
			this.renderAll();
		};
		m.addItem((i) => i.setTitle(T("Extender desde el inicio", "Extend from the start")).setIcon("route").onClick(() => extend(true)));
		m.addItem((i) => i.setTitle(T("Extender desde el final", "Extend from the end")).setIcon("route").onClick(() => extend(false)));
		if (at)
			m.addItem((i) =>
				i
					.setTitle(T("Insertar nodo aquí", "Insert node here"))
					.setIcon("plus-circle")
					.onClick(() => {
						splitSegment(data, route, nearestSegment(data, route, at), at);
						this.persist();
						this.renderAll();
					}),
			);
		m.addItem((i) =>
			i
				.setTitle(T("Invertir sentido", "Reverse direction"))
				.setIcon("arrow-left-right")
				.onClick(() => {
					// El inicio pasa a ser el final: cambia la numeración de los tramos.
					reverseRoute(route);
					this.persist();
					this.renderAll();
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Curvar esta ruta…", "Curve this route…"))
				.setIcon("spline")
				.onClick(() => {
					this.editing = true;
					this.selectedRouteId = route.id;
					this.renderAll();
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(T("Curvas suaves", "Smooth curves"))
				.setIcon("waves")
				.setChecked(route.smooth !== false)
				.onClick(() => {
					route.smooth = route.smooth === false;
					this.persist();
					this.renderAll();
				}),
		);
		if ((route.bends ?? []).some((b) => b.length))
			m.addItem((i) =>
				i
					.setTitle(T("Quitar todas las curvas", "Remove all curves"))
					.setIcon("minus")
					.onClick(() => {
						route.bends = route.bends!.map(() => []);
						this.persist();
						this.renderAll();
					}),
			);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar ruta", "Delete route"))
				.setIcon("trash-2")
				.onClick(() => {
					data.routes = data.routes.filter((r) => r.id !== route.id);
					pruneNodes(data);
					this.persist();
					this.renderAll();
				}),
		);
		m.showAtMouseEvent(evt);
	}

	private onNodeClick(node: RouteNode, e: L.LeafletMouseEvent): void {
		switch (this.mode) {
			case "route":
				this.appendNode(this.ensureActiveRoute(), node.id);
				return;
			case "measure":
				this.measurePick(node, node.id);
				return;
			case "pin":
			case "calibrate":
			case "pick-target":
				this.onMapClick(e);
				return;
		}
	}

	private nodeMenu(node: RouteNode, evt: MouseEvent): void {
		const data = this.mapData!;
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle(T("Empezar ruta desde este nodo", "Start route from this node"))
				.setIcon("route")
				.onClick(() => {
					this.setMode("route");
					this.appendNode(this.ensureActiveRoute(), node.id);
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(T("Medir desde aquí", "Measure from here"))
				.setIcon("ruler")
				.onClick(() => {
					this.setMode("measure");
					this.measurePick(node, node.id);
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar nodo", "Delete node"))
				.setIcon("trash-2")
				.onClick(() => {
					deleteNode(data, node.id);
					this.persist();
					this.renderAll();
				}),
		);
		m.showAtMouseEvent(evt);
	}

	// ---------- Medición y escala ----------

	private visibleRoutes(): MapRoute[] {
		const data = this.mapData!;
		return data.routes.filter((r) => isItemVisible(data, "routes", r.layerId));
	}

	private measurePick(p: Pt, nodeId?: string): void {
		const data = this.mapData!;
		const overlay = this.overlay!;
		if (!this.measureFrom) {
			overlay.clearLayers();
			this.measureFrom = { pt: { x: p.x, y: p.y }, nodeId };
			this.measureText = T("Elige el punto de llegada…", "Choose the end point…");
			L.circleMarker(this.ll(p), { radius: 8, className: "strakes-measure-point", interactive: false }).addTo(overlay);
			this.renderAll();
			return;
		}
		const from = this.measureFrom;
		this.measureFrom = null;
		L.circleMarker(this.ll(p), { radius: 8, className: "strakes-measure-point", interactive: false }).addTo(overlay);

		this.lastMeasure = null;
		if (from.nodeId && nodeId) {
			const res = shortestPath(data, this.visibleRoutes(), from.nodeId, nodeId);
			if (!res) {
				this.measureText = T("No hay camino entre esos nodos por las rutas visibles.", "There's no path between those nodes along the visible routes.");
			} else {
				const pts = pathGeometry(data, res).map((n) => this.ll(n));
				L.polyline(pts, { className: "strakes-measure-line", weight: 8, interactive: false }).addTo(overlay);
				this.lastMeasure = { kind: "path", res };
			}
		} else if (data.scale) {
			L.polyline([this.ll(from.pt), this.ll(p)], { className: "strakes-measure-line is-straight", weight: 4, interactive: false }).addTo(overlay);
			this.lastMeasure = { kind: "line", distance: pixelDistance(from.pt, p) * data.scale };
		} else {
			this.measureText = T(
				"Mapa sin escala: mide entre dos nodos de ruta, o calibra la escala para medir en línea recta.",
				"Map without scale: measure between two route nodes, or calibrate the scale to measure in a straight line.",
			);
		}
		if (this.lastMeasure) this.measureText = this.describeMeasure();
		this.renderAll();
	}

	/**
	 * Texto del resultado de la medición: distancia y tiempo de viaje al paso elegido.
	 * Se recalcula al cambiar de paso sin volver a medir.
	 */
	private describeMeasure(): string {
		const data = this.mapData;
		const m = this.lastMeasure;
		if (!data || !m) return "";
		const pace = this.plugin.settings.travelPace;
		const paceName = PACES[pace].label.toLowerCase();
		const paceTxt = T(`paso ${paceName}`, `${paceName} pace`);
		const segs = (n: number) => {
			const s = n > 1 ? "s" : "";
			return T(`${n} tramo${s}`, `${n} segment${s}`);
		};

		if (m.kind === "line") {
			const t = distanceTime(data, m.distance, pace);
			const time =
				t === null
					? T(`sin tiempo (la unidad «${data.unit}» no es de longitud)`, `no time (the unit "${data.unit}" isn't a length)`)
					: formatTravelTime(t, pace);
			const straight = displayDistance(m.distance, data.unit, this.plugin.settings.displayUnit);
			return T(`Línea recta: ${straight} · ${paceTxt}: ${time}`, `Straight line: ${straight} · ${paceTxt}: ${time}`);
		}
		const res = m.res;
		const extra = res.unknown ? T(` (+ ${segs(res.unknown)} sin distancia)`, ` (+ ${segs(res.unknown)} without distance)`) : "";
		const byRoute = displayDistance(res.distance, data.unit, this.plugin.settings.displayUnit);
		const dist = T(`Por ruta: ${byRoute}${extra} · ${segs(res.legs.length)}`, `By route: ${byRoute}${extra} · ${segs(res.legs.length)}`);
		const t = legsTime(data, res.legs, pace);
		let time: string;
		if (t.unknown === res.legs.length)
			time = T("sin tiempo (añade tiempos a los tramos o usa una unidad de longitud)", "no time (add times to the segments or use a length unit)");
		else time = formatTravelTime(t.hours, pace) + (t.unknown ? T(` + ${segs(t.unknown)} sin tiempo`, ` + ${segs(t.unknown)} without time`) : "");
		return `${dist} · ${paceTxt}: ${time}`;
	}

	private async calibratePick(p: Pt): Promise<void> {
		const data = this.mapData!;
		if (!this.calibrateFrom) {
			this.calibrateFrom = p;
			this.overlay!.clearLayers();
			L.circleMarker(this.ll(p), { radius: 8, className: "strakes-measure-point", interactive: false }).addTo(this.overlay!);
			return;
		}
		const a = this.calibrateFrom;
		this.calibrateFrom = null;
		L.polyline([this.ll(a), this.ll(p)], { className: "strakes-measure-line is-straight", weight: 4, interactive: false }).addTo(this.overlay!);
		const px = pixelDistance(a, p);
		const val = await promptText(this.app, T("Calibrar escala", "Calibrate scale"), {
			description: T(
				"¿Qué distancia real hay entre los dos puntos? Puedes incluir la unidad (ej. 50 km, 3 días).",
				"What's the real distance between the two points? You can include the unit (e.g. 50 km, 3 days).",
			),
			placeholder: `50 ${data.unit}`,
		});
		this.overlay!.clearLayers();
		const parsed = val ? parseDistanceInput(val) : null;
		if (parsed && parsed.value > 0 && px > 0) {
			data.scale = parsed.value / px;
			if (parsed.unit) data.unit = parsed.unit;
			const per100 = displayDistance(data.scale * 100, data.unit, this.plugin.settings.displayUnit);
			new Notice(T(`Escala: 100 px = ${per100}`, `Scale: 100 px = ${per100}`));
			this.persist();
		} else if (val !== null) {
			new Notice(T("Distancia no válida", "Invalid distance"));
		}
		this.setMode("navigate");
	}

	// ---------- Capas y propiedades ----------

	private async addLayer(): Promise<void> {
		const name = await promptText(this.app, T("Nueva capa", "New layer"), { placeholder: T("Ciudades, Caminos, Secretos del DM…", "Cities, Roads, DM secrets…") });
		if (!name?.trim() || !this.mapData) return;
		const layer = { id: uid(), name: name.trim(), visible: true };
		this.mapData.layers.push(layer);
		this.currentLayerId = layer.id;
		this.persist();
		this.renderAll();
	}

	private layerMenu(layerId: string, evt: MouseEvent): void {
		const data = this.mapData!;
		const layer = data.layers.find((l) => l.id === layerId);
		if (!layer) return;
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle(T("Renombrar", "Rename"))
				.setIcon("pencil")
				.onClick(async () => {
					const name = await promptText(this.app, T("Renombrar capa", "Rename layer"), { value: layer.name });
					if (name?.trim()) {
						layer.name = name.trim();
						this.persist();
						this.renderAll();
					}
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(T("Mostrar solo esta capa", "Show only this layer"))
				.setIcon("eye")
				.onClick(() => {
					for (const l of data.layers) l.visible = l.id === layerId;
					this.persist();
					this.renderAll();
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(T("Mostrar todas", "Show all"))
				.setIcon("layers")
				.onClick(() => {
					for (const l of data.layers) l.visible = true;
					this.persist();
					this.renderAll();
				}),
		);
		{
			m.addSeparator();
			m.addItem((i) =>
				i
					.setTitle(T("Eliminar capa…", "Delete layer…"))
					.setIcon("trash-2")
					.onClick(async () => {
						const nP = data.pins.filter((p) => p.layerId === layerId).length;
						const nR = data.routes.filter((r) => r.layerId === layerId).length;
						const ok =
							nP + nR === 0 ||
							(await confirmDialog(
								this.app,
								T("Eliminar capa", "Delete layer"),
								T(
									`La capa «${layer.name}» tiene ${nP} marcadores y ${nR} rutas. Quedarán sin capa (no se eliminan).`,
									`The layer "${layer.name}" has ${nP} markers and ${nR} routes. They'll be left without a layer (they aren't deleted).`,
								),
								T("Eliminar capa", "Delete layer"),
							));
						if (!ok) return;
						for (const p of data.pins) if (p.layerId === layerId) p.layerId = null;
						for (const r of data.routes) if (r.layerId === layerId) r.layerId = null;
						data.layers = data.layers.filter((l) => l.id !== layerId);
						if (this.currentLayerId === layerId) this.currentLayerId = null;
						this.persist();
						this.renderAll();
					}),
			);
		}
		m.showAtMouseEvent(evt);
	}

	private openProps(): void {
		if (!this.mapData) return;
		new MapPropsModal(
			this.app,
			this.mapData,
			(p) => {
				const data = this.mapData!;
				if (p.image !== data.image) {
					data.image = p.image;
					data.width = 0;
					data.height = 0;
					this.needsFit = true;
				}
				data.unit = p.unit;
				data.scale = p.scale;
				data.showDistances = p.showDistances;
				this.persist();
				void this.refresh();
			},
			() => this.setMode("calibrate"),
		).open();
	}
}
