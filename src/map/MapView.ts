import * as L from "leaflet";
import { Keymap, Menu, Notice, Scope, setIcon, setTooltip, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { numberLocale, T } from "../i18n";
import type StrakesTTRPG from "../main";
import { LabelState, MapRegion, uid, VIEW_TYPE_MAP } from "../types";
import { confirmDialog, loadImageSize, promptText } from "../ui/modals";
import { DrawingLayer, laserStrokeExpired, Stroke } from "./drawing";
import { curvePoint, distToSegment, Pt } from "./geometry";
import { ensureZonePane, nodeMarker, pinIcon, pinTooltipOptions, pinTooltipText, segmentLabel, zoneNameLabel, zoneStyle } from "./render";
import { displayArea, pointInPolygon, zoneArea } from "./zones";
import { PinHoverParent } from "./hover";
import { applyAutoNames } from "./autoName";
import { linktextOf, parseWikilink, resolveWikilink } from "./links";
import {
	bendsOf,
	isItemVisible,
	isPlayerVisible,
	legsTime,
	deleteNode,
	distanceTime,
	displayDistance,
	fastestPath,
	formatTotal,
	milesPerUnit,
	newMapUnit,
	formatHours,
	formatTravelTime,
	MapData,
	MapPin,
	MapRoute,
	MapZone,
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
	DEFAULT_ZONE_COLOR,
	pixelDistance,
	pruneNodes,
	reverseRoute,
	ROUTE_COLORS,
	routePath,
	routeTime,
	routeTotal,
	samePath,
	RouteNode,
	segmentControlPoints,
	shortestPath,
	splitSegment,
} from "./mapData";
import { editSegmentDialog, MapPropsModal, PinModal, RouteModal, ZoneModal } from "./mapModals";
import { regionBounds } from "../player/PlayerMap";

type Mode = "navigate" | "pin" | "route" | "zone" | "measure" | "laser" | "pen" | "eraser" | "calibrate" | "pick-target";

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
		case "zone":
			return T(
				"Zona: clic para añadir vértices (cerca de un nodo, se pegan a él). Clic en el primero o Enter para cerrarla. Esc para cancelar.",
				"Zone: click to add vertices (near a node, they snap to it). Click the first one or press Enter to close it. Esc to cancel.",
			);
		case "measure":
			return T(
				"Clic en dos nodos para calcular la distancia por las rutas visibles (o dos puntos si el mapa tiene escala).",
				"Click two nodes to calculate the distance along the visible routes (or two points if the map has a scale).",
			);
		case "laser":
			return T(
				"Láser: mueve el cursor para señalar; mantén el clic y arrastra para dibujar (se desvanece). Clic derecho y arrastrar: mover el mapa. Esc para salir.",
				"Laser: move the cursor to point; hold the click and drag to draw (it fades). Right-click and drag: move the map. Esc to exit.",
			);
		case "pen":
			return T(
				"Lápiz: mantén el clic y arrastra para dibujar. Los dibujos no se guardan: se borran al cerrar Obsidian. Clic derecho y arrastrar: mover el mapa. Esc para salir.",
				"Pen: hold the click and drag to draw. Drawings aren't saved: they're cleared when Obsidian closes. Right-click and drag: move the map. Esc to exit.",
			);
		case "eraser":
			return T(
				"Borrador: haz clic o arrastra sobre un trazo para borrarlo. Clic derecho en el botón del borrador: borrar todos. Clic derecho y arrastrar: mover el mapa. Esc para salir.",
				"Eraser: click or drag over a stroke to erase it. Right-click the eraser button: clear all. Right-click and drag: move the map. Esc to exit.",
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
	private groups = new Map<string, { pins: L.LayerGroup; routes: L.LayerGroup; zones: L.LayerGroup }>();
	private routeLines = new Map<string, L.Polyline>();
	/** Polígono de Leaflet de cada zona, la zona seleccionada (sus vértices, en edición) y la que se dibuja. */
	private zonePolygons = new Map<string, L.Polygon>();
	/** Círculo que indica dónde se pegará el vértice de zona (un nodo o un vértice de otra zona). */
	private snapIndicator: L.CircleMarker | null = null;
	private selectedZoneId: string | null = null;
	private draftZone: Pt[] = [];
	/** Marcadores de Leaflet de cada pin y de cada nodo (uno por ruta que lo usa), para moverlos al arrastrar. */
	private pinMarkers = new Map<string, L.Marker>();
	private nodeMarkers = new Map<string, L.Marker[]>();
	/** Nodo al que se anclaría el marcador que se está arrastrando. */
	private snapTarget: RouteNode | null = null;
	/** Marcador al que se anclaría el nodo que se está arrastrando. */
	private pinSnapTarget: MapPin | null = null;
	/**
	 * Anclaje automático (botón del ancla, visible con la edición desbloqueada). Apagado, no se crean
	 * anclas nuevas; las que ya existen siguen funcionando. No se guarda: al abrir el mapa, encendido.
	 */
	private autoAnchor = true;
	private overlay: L.LayerGroup | null = null; // medición y efectos
	private draftLayer: L.LayerGroup | null = null; // vista previa al dibujar rutas
	private pendingBends: Pt[] = [];

	private mode: Mode = "navigate";
	private editing = false;
	/** Tus etiquetas (sección de etiquetas de la barra, ojo). No se guardan: al abrir el mapa, apagadas. */
	private labels: LabelState = { pins: false, routes: false, zones: false };
	/** Capa activa: si es una capa del usuario, los pines y rutas nuevos van ahí. */
	private currentLayerId: string | null = null;
	private selectedRouteId: string | null = null;
	/** Texto del buscador del panel (capas, rutas y marcadores). */
	private filter = "";

	private activeRouteId: string | null = null;
	private activeRouteIsNew = false;
	/** true = los nodos nuevos se añaden al principio de la ruta («Extender desde el inicio»). */
	private extendAtStart = false;
	private measureFrom: { pt: Pt; nodeId?: string } | null = null;
	/** Mensaje de la medición en su panel («Elige el punto de llegada…», «No hay camino…»). */
	private measureMessage = "";
	/** Puntos de salida y llegada de la medición, para dibujarlos. */
	private measurePoints: Pt[] = [];
	/**
	 * Última medición, para recalcular los textos si cambia el paso o la unidad. En un camino,
	 * `fastest` es null si coincide con el más corto; `show` es el que se resalta en el mapa.
	 */
	private lastMeasure:
		| { kind: "path"; shortest: PathResult; fastest: PathResult | null; show: "shortest" | "fastest" }
		| { kind: "line"; from: Pt; to: Pt; distance: number }
		| null = null;
	private calibrateFrom: Pt | null = null;
	private pickTargetPin: MapPin | null = null;
	private noteLeaf: WorkspaceLeaf | null = null;
	private pinHover = new PinHoverParent(() => this.plugin.settings.pinPreviewTitle);
	private needsFit = true;
	/** Tiempo real: mientras está activo, los jugadores siguen esta vista. */
	private livePlayers = false;
	private liveFrame = 0;
	/** Marco de la vista de jugadores (div fijo sobre el mapa) y rectángulo de lo que ven ahora. */
	private frameEl: HTMLElement | null = null;
	private playerRect: L.LayerGroup | null = null;
	/** Capa del láser y el lápiz; trazo o borrado en curso; avisos pendientes. */
	private drawLayer: DrawingLayer | null = null;
	private drawing: { kind: "laser" | "pen" | "eraser"; stroke: Stroke | null; pointerId: number } | null = null;
	private drawFrame = 0;
	private drawDirty = { laser: false, pen: false };
	/** true tras mover el mapa con el botón derecho: se anula el menú contextual de ese clic. */
	private suppressContext = false;
	/** true mientras se adapta tu vista a un cambio de tamaño: esos movimientos no se envían. */
	private adapting = false;

	private toolbarEl!: HTMLElement;
	private mapEl!: HTMLElement;
	private panelEl!: HTMLElement;
	/** Parte del panel que se redibuja (el buscador queda fuera para no perder el foco). */
	private panelBodyEl!: HTMLElement;
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
			if (this.mode === "zone") {
				this.finishZone();
				return false;
			}
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
		// Pantalla de jugadores: qué muestra, qué región y de qué tamaño es su ventana.
		this.registerEvent(this.plugin.events.on("player-content", () => this.renderAll()));
		this.registerEvent(this.plugin.events.on("player-map-view", () => this.updatePlayerFrame()));
		this.registerEvent(this.plugin.events.on("player-resize", () => this.updatePlayerFrame()));
		// Etiquetas de los jugadores cambiadas (desde este u otro editor del mismo mapa).
		this.registerEvent(
			this.plugin.events.on("player-labels", (path) => {
				if (path === this.file?.path) this.renderToolbar();
			}),
		);
		this.registerEvent(
			this.plugin.events.on("settings", () => {
				this.applyMapSettings();
				this.renderAll();
			}),
		);
		this.toolbarEl = root.createDiv("strakes-map-toolbar");
		const body = root.createDiv("strakes-map-body");
		this.mapEl = body.createDiv("strakes-map-canvas");
		this.panelEl = body.createDiv("strakes-map-panel");
		// Buscador común a capas, rutas y marcadores, fijo arriba del panel.
		const filterEl = this.panelEl.createEl("input", {
			type: "search",
			cls: "strakes-panel-filter",
			attr: { placeholder: T("Buscar…", "Search…") },
		});
		filterEl.oninput = () => {
			this.filter = filterEl.value;
			this.renderPanel();
		};
		this.panelBodyEl = this.panelEl.createDiv("strakes-panel-content");
		this.errorEl = body.createDiv("strakes-map-error");
		this.errorEl.hide();
		this.statusEl = root.createDiv("strakes-map-status");

		this.addAction("settings", T("Propiedades del mapa", "Map properties"), () => this.openProps());
	}

	async onClose(): Promise<void> {
		if (this.liveFrame) window.cancelAnimationFrame(this.liveFrame);
		if (this.drawFrame) this.mapEl.win.cancelAnimationFrame(this.drawFrame);
		if (this.mode === "laser") this.setLaserPointer(null);
		this.drawLayer?.remove();
		this.map?.remove();
		this.map = null;
	}

	onResize(): void {
		this.afterResize();
	}

	/**
	 * Tras cambiar el tamaño del editor. En tiempo real, se adapta tu vista (el zoom) para
	 * seguir mostrando la región de los jugadores: lo que ven ellos no cambia sin querer.
	 */
	private afterResize(): void {
		const map = this.map;
		if (!map) return;
		const pc = this.plugin.playerContent;
		const keep = this.livePlayers && this.isOnPlayerScreen() && pc?.kind === "map" ? pc.region : null;
		this.adapting = true;
		try {
			map.invalidateSize();
			// Zoom exacto (sin redondear al incremento): la región tiene que quedar igual.
			if (keep) this.exactZoom(() => map.fitBounds(regionBounds(keep), { animate: false }));
		} finally {
			this.adapting = false;
		}
		this.updatePlayerFrame();
	}

	/**
	 * Ejecuta un encuadre sin redondear el zoom al incremento (`zoomSnap`), para que lo
	 * encuadrado quepa exacto. Con flyToBounds basta: el zoom de destino se calcula al llamarlo.
	 */
	private exactZoom(fit: () => void): void {
		const map = this.map;
		if (!map) return;
		const snap = map.options.zoomSnap;
		map.options.zoomSnap = 0;
		try {
			fit();
		} finally {
			map.options.zoomSnap = snap;
		}
	}

	/**
	 * Ajustes del plugin que afectan al mapa: el incremento del zoom (rueda y botones) y la
	 * transparencia de lo que no ven los jugadores.
	 */
	private applyMapSettings(): void {
		const s = this.plugin.settings;
		const map = this.map;
		if (map) {
			const step = s.mapZoomStep > 0 ? s.mapZoomStep : 0.5;
			map.options.zoomSnap = step;
			map.options.zoomDelta = step;
			// Así cada paso de la rueda da exactamente un incremento (Leaflet redondea hacia arriba a zoomSnap).
			map.options.wheelPxPerZoomLevel = 100 / step;
		}
		this.mapEl.setCssProps({ "--strakes-not-player-opacity": String(1 - s.notPlayerTransparency / 100) });
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
		this.mapData = normalizeMap(raw, newMapUnit(this.plugin.settings.displayUnit));
		if (clear) {
			this.labels = { pins: false, routes: false, zones: false };
			this.needsFit = true;
			this.mode = "navigate";
			this.activeRouteId = null;
			this.measureMessage = "";
			this.measurePoints = [];
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
			g.zones.remove();
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
		this.announceData();
	}

	/** Avisa del estado actual del mapa (la pantalla de jugadores lo redibuja sin esperar al guardado). */
	private announceData(): void {
		if (this.file && this.mapData) this.plugin.events.trigger("map-data", this.file.path, this.mapData);
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
		this.measureMessage = "";
		this.measurePoints = [];
		this.overlay?.clearLayers();
		this.requestSave();
		this.updateHistoryButtons();
		this.announceData();
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
		map.on("move", () => this.followLive());
		// Dibujando una zona: el círculo indica dónde se pegaría el próximo vértice.
		map.on("mousemove", (e: L.LeafletMouseEvent) => {
			if (this.mode === "zone") this.showSnap(this.zoneSnapPoint(e.latlng));
		});
		map.on("contextmenu", (e: L.LeafletMouseEvent) => this.onMapContextMenu(e));
		this.overlay = L.layerGroup().addTo(map);
		this.draftLayer = L.layerGroup().addTo(map);
		this.map = map;
		ensureZonePane(map);
		this.applyMapSettings();
		this.setupDrawing(map);
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
				// La imagen va en el panel más bajo de Leaflet: por encima quedan zonas, rutas y marcadores.
				this.imageOverlay = L.imageOverlay(src, this.bounds(), { interactive: false, pane: "tilePane" }).addTo(map);
				this.imageOverlay.bringToBack();
				map.setMaxBounds(this.bounds().pad(0.5));
			}
		}
		if (this.needsFit && data.width && data.height) {
			this.needsFit = false;
			map.invalidateSize();
			this.exactZoom(() => map.fitBounds(this.bounds()));
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
		this.renderAll();
	}

	private renderAll(): void {
		const data = this.mapData;
		const map = this.map;
		if (!data || !map) return;

		for (const g of this.groups.values()) {
			g.pins.remove();
			g.routes.remove();
			g.zones.remove();
		}
		this.groups.clear();
		this.routeLines.clear();
		this.zonePolygons.clear();
		this.pinMarkers.clear();
		this.nodeMarkers.clear();
		this.snapTarget = null;
		this.pinSnapTarget = null;

		// Un grupo por capa más uno para «sin capa» (clave ""). Cada grupo se muestra
		// según el interruptor de su tipo (Pines / Rutas) y la visibilidad de la capa.
		for (const layerId of ["", ...data.layers.map((l) => l.id)]) {
			const g = { pins: L.layerGroup(), routes: L.layerGroup(), zones: L.layerGroup() };
			this.groups.set(layerId, g);
			if (isItemVisible(data, "zones", layerId || null)) g.zones.addTo(map);
			if (isItemVisible(data, "routes", layerId || null)) g.routes.addTo(map);
			if (isItemVisible(data, "pins", layerId || null)) g.pins.addTo(map);
		}

		// Zonas (en su propio panel de Leaflet, por debajo de rutas y marcadores).
		if (this.selectedZoneId && !data.zones.some((z) => z.id === this.selectedZoneId)) this.selectedZoneId = null;
		for (const zone of data.zones) this.renderZone(zone);
		const nodes = nodeMap(data);
		for (const route of data.routes) this.renderRoute(route, nodes);
		for (const pin of data.pins) this.renderPin(pin);

		this.renderDraft();
		this.renderToolbar();
		this.renderPanel();
		this.renderStatus();
		this.mapEl.toggleClass("is-editing", this.editing);
		this.mapEl.dataset.mode = this.mode;
		if (this.file) {
			this.drawLayer?.setPen(this.plugin.penFor(this.file.path));
			this.drawLayer?.setLaser(this.plugin.laserFor(this.file.path));
		}
		this.updatePlayerFrame();
	}

	private renderPin(pin: MapPin): void {
		const g = this.groups.get(pin.layerId ?? "");
		if (!g || pin.hidden) return;
		const marker = L.marker(this.ll(pin), {
			icon: pinIcon(pin),
			draggable: this.editing,
			keyboard: false,
			riseOnHover: true,
		});
		marker.bindTooltip(pinTooltipText(pin), pinTooltipOptions(pin, this.labels.pins));
		// Con el mapa en la pantalla de jugadores, lo que ellos no ven sale semitransparente.
		if (this.isOnPlayerScreen() && !isPlayerVisible(this.mapData!, "pins", pin)) marker.on("add", () => marker.getElement()?.addClass("strakes-not-player"));
		marker.on("click", (e: L.LeafletMouseEvent) => this.onPinClick(pin, e.originalEvent));
		marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stop(e.originalEvent);
			this.pinMenu(pin, e.originalEvent);
		});
		// Anclado a un nodo: se mueven juntos. Suelto: al soltarlo cerca de un nodo, se ancla a él.
		marker.on("drag", () => this.onPinDrag(pin, marker));
		marker.on("dragend", () => this.onPinDragEnd(pin, marker));
		marker.on("mouseover", (e: L.LeafletMouseEvent) =>
			this.pinHover.show(this.app, pin, e.originalEvent, marker.getElement(), this.file?.path ?? ""),
		);
		this.pinMarkers.set(pin.id, marker);
		g.pins.addLayer(marker);
	}

	private renderRoute(route: MapRoute, nodes: Map<string, RouteNode>): void {
		const data = this.mapData!;
		const g = this.groups.get(route.layerId ?? "");
		// Oculta con el ojo: no se dibuja, salvo la que se está trazando o extendiendo.
		if (!g || (route.hidden && this.activeRouteId !== route.id)) return;
		const latlngs = routePath(route, nodes).map((p) => this.ll(p));
		const selected = this.selectedRouteId === route.id || this.activeRouteId === route.id;
		const line = L.polyline(latlngs, {
			color: route.color || ROUTE_COLORS[0],
			weight: selected ? 6 : 4,
			opacity: 0.9,
			bubblingMouseEvents: false,
			className: this.isOnPlayerScreen() && !isPlayerVisible(data, "routes", route) ? "strakes-route-line strakes-not-player" : "strakes-route-line",
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
			if (this.mode === "pin" || this.mode === "zone" || this.mode === "calibrate" || this.mode === "pick-target" || this.mode === "measure") {
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

		// Etiquetas de tramo («número · ruta») en el centro de cada tramo.
		if (this.labels.routes) {
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
			// Con el ancla encendida, los vértices de zona en el mismo punto que el nodo se mueven con él.
			let zoneVertices: { zone: MapZone; index: number }[] = [];
			const moveZoneVertices = (p: Pt) => {
				for (const v of zoneVertices) {
					v.zone.points[v.index] = { x: p.x, y: p.y };
					this.zonePolygons.get(v.zone.id)?.setLatLngs(v.zone.points.map((q) => this.ll(q)));
				}
			};
			marker.on("dragstart", () => (zoneVertices = this.autoAnchor ? this.sharedVertices(null, n) : []));
			marker.on("drag", () => {
				const p = this.pt(marker.getLatLng());
				n.x = p.x;
				n.y = p.y;
				for (const r of data.routes) if (r.nodeIds.includes(n.id)) this.redrawRouteLine(r, nodes);
				moveZoneVertices(p);
				// Los marcadores anclados a este nodo lo siguen.
				for (const pin of data.pins)
					if (pin.nodeId === n.id) {
						pin.x = p.x;
						pin.y = p.y;
						this.pinMarkers.get(pin.id)?.setLatLng(this.ll(pin));
					}
				// Cerca de un marcador suelto: se resalta, y al soltar quedan anclados.
				this.setPinSnapTarget(this.autoAnchor ? this.nearestLoosePin(marker.getLatLng()) : null);
			});
			marker.on("dragend", () => {
				const target = this.pinSnapTarget;
				this.setPinSnapTarget(null);
				if (target && !this.nodeTaken(n.id, target)) {
					// El nodo se pega al marcador.
					n.x = target.x;
					n.y = target.y;
					target.nodeId = n.id;
					for (const pin of data.pins)
						if (pin.nodeId === n.id) {
							pin.x = n.x;
							pin.y = n.y;
						}
				}
				moveZoneVertices(n);
				zoneVertices = [];
				this.persist();
				this.renderAll();
			});
			const list = this.nodeMarkers.get(n.id) ?? [];
			list.push(marker);
			this.nodeMarkers.set(n.id, list);
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
		const setColor = (m: L.Marker) => m.on("add", () => m.getElement()?.setCssProps({ "--route-color": route.color }));
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
			b.toggleClass("is-active", this.mode === mode);
		};
		// Deshacer / rehacer los cambios del mapa.
		this.undoBtn = this.toolButton(tb, "undo-2", T("Deshacer", "Undo"), () => this.undo());
		this.redoBtn = this.toolButton(tb, "redo-2", T("Rehacer", "Redo"), () => this.redo());
		this.updateHistoryButtons();
		tb.createDiv("strakes-toolbar-sep");
		tool("navigate", "hand", T("Navegar", "Navigate"));
		tool("pin", "map-pin", T("Añadir marcador", "Add marker"));
		tool("route", "route", T("Crear ruta", "Create route"));
		tool("zone", "pentagon", T("Crear zona", "Create zone"));
		// Medir: el botón y, con la herramienta activa, su panel debajo (paso de viaje y resultado).
		const measureWrap = tb.createDiv("strakes-measure-tool");
		this.toolButton(measureWrap, "ruler", T("Medir distancia y tiempo de viaje", "Measure distance and travel time"), () =>
			this.setMode(this.mode === "measure" ? "navigate" : "measure"),
		).toggleClass("is-active", this.mode === "measure");
		if (this.mode === "measure") this.renderMeasurePanel(measureWrap.createDiv("strakes-measure-panel"));
		// Láser, lápiz y borrador (los dibujos no se guardan).
		tool(
			"laser",
			"crosshair",
			T("Láser: señala con el cursor y arrastra para dibujar trazos que se desvanecen", "Laser: point with the cursor and drag to draw strokes that fade"),
		);
		tool(
			"pen",
			"pen",
			T("Lápiz: los dibujos no se guardan, se borran al cerrar Obsidian", "Pen: drawings aren't saved, they're cleared when Obsidian closes"),
		);
		if (this.mode === "pen") {
			const color = tb.createEl("input", { type: "color", cls: "strakes-pen-color" });
			color.value = this.penColor();
			setTooltip(color, T("Color del lápiz", "Pen color"));
			color.addEventListener("input", () => (this.plugin.penColor = color.value));
		}
		const eraser = this.toolButton(
			tb,
			"eraser",
			T("Borrador: borra trazos del lápiz · clic derecho: borrar todos los dibujos", "Eraser: erases pen strokes · right-click: clear all drawings"),
			() => this.setMode(this.mode === "eraser" ? "navigate" : "eraser"),
		);
		eraser.toggleClass("is-active", this.mode === "eraser");
		eraser.oncontextmenu = (evt) => {
			evt.preventDefault();
			const m = new Menu();
			m.addItem((i) =>
				i
					.setTitle(T("Borrar todos los dibujos", "Clear all drawings"))
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => this.clearDrawings()),
			);
			m.showAtMouseEvent(evt);
		};
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
		if (this.editing)
			this.toolButton(
				tb,
				"anchor",
				this.autoAnchor
					? T(
							"Anclaje automático activado: lo que sueltas cerca se pega (marcadores a nodos, vértices de zona a nodos y vértices) y lo que comparte un punto se mueve junto (clic para desactivarlo)",
							"Auto-anchoring on: what you drop close by snaps (markers to nodes, zone vertices to nodes and vertices) and what shares a point moves together (click to turn it off)",
						)
					: T(
							"Anclaje automático desactivado: nada se pega y cada cosa se mueve sola (los marcadores ya anclados siguen con su nodo)",
							"Auto-anchoring off: nothing snaps and each thing moves on its own (markers already anchored stay with their node)",
						),
				() => {
					this.autoAnchor = !this.autoAnchor;
					this.renderToolbar();
				},
			).toggleClass("is-active", this.autoAnchor);
		this.renderLabelTools(tb);
		this.toolButton(tb, "maximize", T("Encuadrar todo el mapa", "Fit the whole map"), () => this.exactZoom(() => this.map?.flyToBounds(this.bounds(), { duration: 0.5 })));
		tb.createDiv("strakes-toolbar-sep");
		// Pantalla de jugadores: enviar lo que hay dentro del marco, o seguir tu vista en tiempo real.
		const onScreen = this.isOnPlayerScreen();
		this.toolButton(
			tb,
			"monitor-up",
			onScreen
				? T("Enviar esta vista a los jugadores (lo que hay dentro del marco)", "Send this view to the players (what's inside the frame)")
				: T("Enviar el mapa a la pantalla de jugadores, con esta vista", "Send the map to the player screen, with this view"),
			() => this.sendViewToPlayers(),
		);
		this.toolButton(
			tb,
			"cast",
			this.livePlayers
				? T("Tiempo real activado: los jugadores siguen tu vista (clic para desactivarlo)", "Live view on: the players follow your view (click to turn it off)")
				: T("Tiempo real: que los jugadores sigan tu vista", "Live view: make the players follow your view"),
			() => this.toggleLivePlayers(),
		).toggleClass("is-active", this.livePlayers);
		tb.createDiv("strakes-toolbar-spacer");
		this.toolButton(tb, "panel-right", T("Mostrar/ocultar panel", "Show/hide panel"), () => {
			this.panelOpen = !this.panelOpen;
			this.renderPanel();
			window.setTimeout(() => this.afterResize(), 50);
		}).toggleClass("is-active", this.panelOpen);
	}

	// ---------- Zonas (1.3) ----------

	private renderZone(zone: MapZone): void {
		const data = this.mapData!;
		const g = this.groups.get(zone.layerId ?? "");
		if (!g || zone.hidden) return;
		const selected = this.selectedZoneId === zone.id;
		// Con el mapa en la pantalla de jugadores, lo que ellos no ven sale semitransparente.
		const dim = this.isOnPlayerScreen() && !isPlayerVisible(data, "zones", zone);
		const poly = L.polygon(
			zone.points.map((p) => this.ll(p)),
			{ ...zoneStyle(zone, this.plugin.settings.zoneFillTransparency), weight: selected ? 3 : 2, bubblingMouseEvents: false, className: dim ? "strakes-zone strakes-not-player" : "strakes-zone" },
		);
		// Nombre: en el centro con las etiquetas de zona; si no, al pasar el cursor.
		if (this.labels.zones) {
			const label = zoneNameLabel(zone);
			if (label) g.zones.addLayer(label);
		} else if (zone.name.trim()) poly.bindTooltip(zone.name, { sticky: true, className: "strakes-map-tooltip" });
		poly.on("click", (e: L.LeafletMouseEvent) => this.onZoneClick(e));
		poly.on("contextmenu", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stop(e.originalEvent);
			this.pickZone(this.zonesAt(this.pt(e.latlng)), e.originalEvent, (z) => this.zoneMenu(z, e.originalEvent));
		});
		poly.on("mouseover", (e: L.LeafletMouseEvent) => {
			if (zone.link) this.pinHover.show(this.app, zone, e.originalEvent, undefined, this.file?.path ?? "");
		});
		this.zonePolygons.set(zone.id, poly);
		g.zones.addLayer(poly);
		if (this.editing) this.renderZoneHandles(zone, poly, g.zones, selected);
		else if (this.mode === "zone")
			for (const p of zone.points)
				g.zones.addLayer(L.circleMarker(this.ll(p), { pane: "markerPane", radius: 3, color: zone.borderColor, fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }));
	}

	/** Zonas visibles en tu vista que contienen el punto, de la de más arriba a la de más abajo. */
	private zonesAt(p: Pt): MapZone[] {
		const data = this.mapData;
		if (!data) return [];
		return data.zones.filter((z) => !z.hidden && isItemVisible(data, "zones", z.layerId) && pointInPolygon(p, z.points)).reverse();
	}

	/** Con varias zonas solapadas en el punto, un menú para elegir cuál; con una, directamente. */
	private pickZone(zones: MapZone[], evt: MouseEvent, act: (z: MapZone) => void): void {
		if (!zones.length) return;
		if (zones.length === 1) {
			act(zones[0]);
			return;
		}
		const m = new Menu();
		for (const z of zones) m.addItem((i) => i.setTitle(z.name.trim() || T("(zona sin nombre)", "(unnamed zone)")).setIcon("pentagon").onClick(() => act(z)));
		m.showAtMouseEvent(evt);
	}

	/**
	 * Clic en una zona. Fuera de Navegar no estorba: el clic va al mapa (colocar un marcador, una
	 * ruta, medir, dibujar otra zona…). En Navegar, con la edición desbloqueada la selecciona (para
	 * mover sus vértices); si no, abre su nota.
	 */
	private onZoneClick(e: L.LeafletMouseEvent): void {
		if (this.mode !== "navigate") {
			this.onMapClick(e);
			return;
		}
		const evt = e.originalEvent;
		this.pickZone(this.zonesAt(this.pt(e.latlng)), evt, (zone) => {
			if (this.editing) {
				this.selectedZoneId = this.selectedZoneId === zone.id ? null : zone.id;
				this.renderAll();
			} else if (zone.link) void this.openPinLink(zone, Keymap.isModEvent(evt));
		});
	}

	/**
	 * Punto al que se pega un vértice de zona: el nodo de ruta o el vértice de otra zona visible más
	 * cercano, a menos de SNAP_PX en pantalla (sin vínculo: solo toma su posición). Con el anclaje
	 * automático apagado, ninguno. `exceptZone`: la zona del vértice que se arrastra (no se pega a sí
	 * misma); `skip`: vértices que se mueven con él («idZona:índice»), que tampoco cuentan.
	 */
	private zoneSnapPoint(ll: L.LatLng, exceptZone?: string, skip?: Set<string>): Pt | null {
		const map = this.map;
		const data = this.mapData;
		if (!map || !data || !this.autoAnchor) return null;
		const c = map.latLngToContainerPoint(ll);
		let best: Pt | null = null;
		let bestD = MapView.SNAP_PX;
		const consider = (p: Pt) => {
			const d = map.latLngToContainerPoint(this.ll(p)).distanceTo(c);
			if (d <= bestD) {
				bestD = d;
				best = { x: p.x, y: p.y };
			}
		};
		const node = this.nearestNode(ll);
		if (node) consider(node);
		for (const z of data.zones) {
			if (z.id === exceptZone || z.hidden || !isItemVisible(data, "zones", z.layerId)) continue;
			z.points.forEach((p, i) => {
				if (!skip?.has(`${z.id}:${i}`)) consider(p);
			});
		}
		return best;
	}

	/**
	 * Vértices de zonas visibles (salvo `zone`) que están exactamente en el punto `p`: los compartidos
	 * por dos zonas contiguas, o los que están sobre un nodo. Al arrastrar el vértice o el nodo se
	 * mueven con él (solo con el ancla encendida). No se guarda ningún vínculo.
	 */
	private sharedVertices(zone: MapZone | null, p: Pt): { zone: MapZone; index: number }[] {
		const data = this.mapData;
		if (!data || !p) return [];
		const out: { zone: MapZone; index: number }[] = [];
		for (const z of data.zones) {
			if (z === zone || z.hidden || !isItemVisible(data, "zones", z.layerId)) continue;
			z.points.forEach((q, index) => {
				if (Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) out.push({ zone: z, index });
			});
		}
		return out;
	}

	/** Muestra (o quita, con null) el círculo de dónde se pegará el vértice. */
	private showSnap(p: Pt | null): void {
		if (!p) {
			this.snapIndicator?.remove();
			this.snapIndicator = null;
			return;
		}
		if (!this.map) return;
		if (this.snapIndicator) this.snapIndicator.setLatLng(this.ll(p));
		else this.snapIndicator = L.circleMarker(this.ll(p), { radius: 9, className: "strakes-snap-indicator", interactive: false, fill: false, weight: 3 }).addTo(this.map);
	}

	/** Clic en modo Zona: añade un vértice (pegado a un nodo o a otro vértice cercano) o, en el primero, cierra la zona. */
	private addZoneVertex(ll: L.LatLng): void {
		const map = this.map;
		if (!map) return;
		const first = this.draftZone[0];
		if (first && this.draftZone.length >= 3 && map.latLngToContainerPoint(this.ll(first)).distanceTo(map.latLngToContainerPoint(ll)) <= MapView.SNAP_PX) {
			this.finishZone();
			return;
		}
		// Cerca de un nodo o del vértice de otra zona (con el anclaje automático): toma su posición, sin
		// vínculo. Así dos zonas contiguas (habitaciones, provincias) comparten vértices y no se cruzan.
		this.draftZone.push(this.zoneSnapPoint(ll) ?? this.pt(ll));
		this.showSnap(null);
		this.renderAll();
	}

	/** Cierra la zona que se está dibujando (Enter o clic en el primer vértice) y abre su diálogo. */
	private finishZone(): void {
		const data = this.mapData;
		if (!data) return;
		const pts = this.draftZone;
		this.draftZone = [];
		this.setMode("navigate");
		if (pts.length < 3) {
			if (pts.length) new Notice(T("Una zona necesita al menos 3 vértices.", "A zone needs at least 3 vertices."));
			return;
		}
		const zone: MapZone = {
			id: uid(),
			name: "",
			points: pts,
			layerId: this.currentLayerId,
			// Como en las rutas: un color de la paleta, rotando; el mismo para el relleno y el borde.
			color: ROUTE_COLORS[data.zones.length % ROUTE_COLORS.length],
			borderColor: ROUTE_COLORS[data.zones.length % ROUTE_COLORS.length],
			autoName: true,
		};
		this.openZoneModal(zone, true);
	}

	private openZoneModal(zone: MapZone, isNew: boolean): void {
		const data = this.mapData!;
		new ZoneModal(this.app, data, zone, isNew, this.file?.path ?? "", (r) => {
			if (r.action === "delete") data.zones = data.zones.filter((z) => z.id !== zone.id);
			else {
				const i = data.zones.findIndex((z) => z.id === r.zone.id);
				if (i >= 0) data.zones[i] = r.zone;
				else data.zones.push(r.zone);
			}
			if (this.selectedZoneId && !data.zones.some((z) => z.id === this.selectedZoneId)) this.selectedZoneId = null;
			this.persist();
			this.renderAll();
		}).open();
	}

	/**
	 * Asideros de una zona (con la edición desbloqueada): ● vértices, en todas las zonas, que se
	 * arrastran y se quitan con doble clic o clic derecho (mínimo 3); ◦ fantasmas a mitad de cada
	 * lado, solo en la seleccionada, que al arrastrarlos crean un vértice. Un vértice soltado cerca de
	 * un nodo o del vértice de otra zona toma su posición (sin vínculo).
	 */
	private renderZoneHandles(zone: MapZone, poly: L.Polygon, group: L.LayerGroup, withGhosts: boolean): void {
		const handleIcon = (cls: string) => L.divIcon({ className: cls, html: "", iconSize: [12, 12], iconAnchor: [6, 6] });
		const setColor = (m: L.Marker) => m.on("add", () => m.getElement()?.setCssProps({ "--route-color": zone.borderColor }));
		const tip = { direction: "top" as const, offset: [0, -8] as L.PointExpression, className: "strakes-map-tooltip" };
		const redraw = () => poly.setLatLngs(zone.points.map((p) => this.ll(p)));
		let snap: Pt | null = null;
		/** Vértices de otras zonas visibles en el mismo punto que el que se arrastra: se mueven con él. */
		let shared: { zone: MapZone; index: number }[] = [];
		const moveShared = (p: Pt) => {
			for (const v of shared) {
				v.zone.points[v.index] = { ...p };
				this.zonePolygons.get(v.zone.id)?.setLatLngs(v.zone.points.map((q) => this.ll(q)));
			}
		};
		const snapWhileDragging = (m: L.Marker) => {
			snap = this.zoneSnapPoint(m.getLatLng(), zone.id, new Set(shared.map((v) => `${v.zone.id}:${v.index}`)));
			this.showSnap(snap);
		};
		const finish = (j: number) => {
			this.showSnap(null);
			if (snap && zone.points[j]) {
				zone.points[j] = { ...snap };
				moveShared(snap);
			}
			snap = null;
			shared = [];
			this.persist();
			this.renderAll();
		};
		// Dibujando una zona, un clic en un asidero pone ahí el vértice nuevo (si no, el asidero se queda el clic).
		const clickInZoneMode = (m: L.Marker) =>
			m.on("click", (e: L.LeafletMouseEvent) => {
				if (this.mode !== "zone") return;
				L.DomEvent.stop(e.originalEvent);
				this.addZoneVertex(m.getLatLng());
			});

		zone.points.forEach((pt, j) => {
			const m = L.marker(this.ll(pt), { icon: handleIcon("strakes-bend"), draggable: true, keyboard: false });
			setColor(m);
			m.bindTooltip(T("Vértice · doble clic o clic derecho para quitarlo", "Vertex · double-click or right-click to remove it"), tip);
			clickInZoneMode(m);
			// Con el ancla apagada, cada vértice se mueve solo aunque otro esté en el mismo punto.
			m.on("dragstart", () => (shared = this.autoAnchor ? this.sharedVertices(zone, zone.points[j]) : []));
			m.on("drag", () => {
				const p = this.pt(m.getLatLng());
				zone.points[j] = p;
				redraw();
				moveShared(p);
				snapWhileDragging(m);
			});
			m.on("dragend", () => finish(j));
			const remove = () => {
				if (zone.points.length <= 3) {
					new Notice(T("Una zona necesita al menos 3 vértices.", "A zone needs at least 3 vertices."));
					return;
				}
				zone.points.splice(j, 1);
				this.persist();
				this.renderAll();
			};
			m.on("dblclick", (e: L.LeafletMouseEvent) => {
				L.DomEvent.stop(e.originalEvent);
				// Dibujando una zona, el doble clic son dos clics de vértice: no se quita nada.
				if (this.mode !== "zone") remove();
			});
			// Clic derecho: lo quita directamente (no hay más opciones).
			m.on("contextmenu", (e: L.LeafletMouseEvent) => {
				L.DomEvent.stop(e.originalEvent);
				remove();
			});
			group.addLayer(m);
		});

		if (!withGhosts) return;
		zone.points.forEach((a, k) => {
			const b = zone.points[(k + 1) % zone.points.length];
			const ghost = L.marker(this.ll({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), { icon: handleIcon("strakes-bend-ghost"), draggable: true, keyboard: false });
			setColor(ghost);
			ghost.bindTooltip(T("Arrastra para añadir un vértice", "Drag to add a vertex"), tip);
			clickInZoneMode(ghost);
			let inserted = false;
			ghost.on("dragstart", () => {
				zone.points.splice(k + 1, 0, this.pt(ghost.getLatLng()));
				inserted = true;
			});
			ghost.on("drag", () => {
				if (!inserted) return;
				zone.points[k + 1] = this.pt(ghost.getLatLng());
				redraw();
				snapWhileDragging(ghost);
			});
			ghost.on("dragend", () => finish(k + 1));
			group.addLayer(ghost);
		});
	}

	private zoneMenu(zone: MapZone, evt: MouseEvent): void {
		const data = this.mapData!;
		const m = new Menu();
		if (zone.link) {
			m.addItem((i) => i.setTitle(T("Abrir nota", "Open note")).setIcon("file-text").onClick(() => void this.openPinLink(zone, false)));
			m.addItem((i) =>
				i
					.setTitle(T("Enviar nota a la pantalla de jugadores", "Send note to player screen"))
					.setIcon("monitor")
					.onClick(() => this.sendPinToPlayers(zone)),
			);
		}
		m.addItem((i) => i.setTitle(T("Editar…", "Edit…")).setIcon("pencil").onClick(() => this.openZoneModal(zone, false)));
		m.addItem((i) =>
			i
				.setTitle(T("Editar forma", "Edit shape"))
				.setIcon("pentagon")
				.onClick(() => {
					// Desbloquea la edición y la selecciona: aparecen sus vértices.
					this.editing = true;
					this.selectedZoneId = zone.id;
					this.renderAll();
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(zone.players ? T("Ocultar a los jugadores", "Hide from players") : T("Mostrar a los jugadores", "Show to players"))
				.setIcon(zone.players ? "monitor-off" : "monitor")
				.onClick(() => {
					zone.players = zone.players ? undefined : true;
					this.persist();
					this.renderAll();
				}),
		);
		this.addMoveToLayerItem(m, evt, zone);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar", "Delete"))
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					data.zones = data.zones.filter((z) => z.id !== zone.id);
					if (this.selectedZoneId === zone.id) this.selectedZoneId = null;
					this.persist();
					this.renderAll();
				}),
		);
		m.showAtMouseEvent(evt);
	}

	// ---------- Marcadores anclados a nodos ----------

	/** Distancia (px de pantalla) a la que un marcador arrastrado se ancla a un nodo. */
	private static readonly SNAP_PX = 15;

	/** Nodo de una ruta visible más cercano a un punto, a menos de SNAP_PX en pantalla. */
	private nearestNode(ll: L.LatLng): RouteNode | null {
		const map = this.map;
		const data = this.mapData;
		if (!map || !data) return null;
		const visible = new Set(this.visibleRoutes().flatMap((r) => r.nodeIds));
		const c = map.latLngToContainerPoint(ll);
		let best: RouteNode | null = null;
		let bestD = MapView.SNAP_PX;
		for (const n of data.nodes) {
			if (!visible.has(n.id)) continue;
			const d = map.latLngToContainerPoint(this.ll(n)).distanceTo(c);
			if (d <= bestD) {
				bestD = d;
				best = n;
			}
		}
		return best;
	}

	/** Resalta el nodo al que se anclaría el marcador que se está arrastrando. */
	private setSnapTarget(node: RouteNode | null): void {
		if (this.snapTarget?.id === node?.id) return;
		for (const m of this.nodeMarkers.get(this.snapTarget?.id ?? "") ?? []) m.getElement()?.removeClass("is-snap-target");
		this.snapTarget = node;
		for (const m of this.nodeMarkers.get(node?.id ?? "") ?? []) m.getElement()?.addClass("is-snap-target");
	}

	/**
	 * Marcador suelto y visible más cercano a un punto, a menos de SNAP_PX en pantalla (al
	 * arrastrar un nodo). Los anclados a otro nodo no se roban.
	 */
	private nearestLoosePin(ll: L.LatLng): MapPin | null {
		const map = this.map;
		const data = this.mapData;
		if (!map || !data) return null;
		const c = map.latLngToContainerPoint(ll);
		let best: MapPin | null = null;
		let bestD = MapView.SNAP_PX;
		for (const pin of data.pins) {
			if (this.anchorNode(pin) || pin.hidden || !isItemVisible(data, "pins", pin.layerId)) continue;
			const d = map.latLngToContainerPoint(this.ll(pin)).distanceTo(c);
			if (d <= bestD) {
				bestD = d;
				best = pin;
			}
		}
		return best;
	}

	/** Resalta el marcador al que se anclaría el nodo que se está arrastrando. */
	private setPinSnapTarget(pin: MapPin | null): void {
		if (this.pinSnapTarget?.id === pin?.id) return;
		this.pinMarkers.get(this.pinSnapTarget?.id ?? "")?.getElement()?.removeClass("is-snap-target");
		this.pinSnapTarget = pin;
		this.pinMarkers.get(pin?.id ?? "")?.getElement()?.addClass("is-snap-target");
	}

	/**
	 * Un nodo solo puede tener un marcador anclado. Si `nodeId` ya tiene uno (distinto de `except`),
	 * avisa de que hay que desanclarlo primero y devuelve true (no se debe anclar).
	 */
	private nodeTaken(nodeId: string, except?: MapPin): boolean {
		const other = this.mapData?.pins.find((p) => p.nodeId === nodeId && p !== except);
		if (!other) return false;
		const name = other.name.trim() || T("otro marcador", "another marker");
		new Notice(
			T(
				`Ese nodo ya tiene anclado «${name}». Desáncalo primero (clic derecho → Desanclar del nodo).`,
				`That node already has "${name}" anchored. Unanchor it first (right-click → Unanchor from node).`,
			),
		);
		return true;
	}

	/** Nodo al que está anclado el marcador, si sigue existiendo. */
	private anchorNode(pin: MapPin): RouteNode | undefined {
		return pin.nodeId ? this.mapData?.nodes.find((n) => n.id === pin.nodeId) : undefined;
	}

	/**
	 * Mientras se arrastra un marcador: si está anclado, su nodo (y las rutas) van con él; si no,
	 * se resalta el nodo al que se anclaría al soltarlo.
	 */
	private onPinDrag(pin: MapPin, marker: L.Marker): void {
		const data = this.mapData;
		if (!data) return;
		const node = this.anchorNode(pin);
		if (!node) {
			this.setSnapTarget(this.autoAnchor ? this.nearestNode(marker.getLatLng()) : null);
			return;
		}
		const p = this.pt(marker.getLatLng());
		node.x = p.x;
		node.y = p.y;
		for (const m of this.nodeMarkers.get(node.id) ?? []) m.setLatLng(this.ll(node));
		const nodes = nodeMap(data);
		for (const r of data.routes) if (r.nodeIds.includes(node.id)) this.redrawRouteLine(r, nodes);
	}

	/** Al soltar un marcador: anclado, mueve también el nodo; suelto y cerca de un nodo, se ancla a él. */
	private onPinDragEnd(pin: MapPin, marker: L.Marker): void {
		const p = this.pt(marker.getLatLng());
		const target = this.snapTarget;
		this.setSnapTarget(null);
		const node = this.anchorNode(pin);
		if (node) {
			node.x = p.x;
			node.y = p.y;
			pin.x = p.x;
			pin.y = p.y;
		} else if (target && !this.nodeTaken(target.id, pin)) {
			pin.nodeId = target.id;
			pin.x = target.x;
			pin.y = target.y;
		} else {
			pin.nodeId = undefined;
			pin.x = p.x;
			pin.y = p.y;
		}
		this.persist();
		this.renderAll();
	}

	// ---------- Láser, lápiz y borrador ----------

	/** ¿Está activa una herramienta de dibujo? (clic izquierdo: dibujar o borrar; derecho y arrastrar: mover el mapa) */
	private isDrawMode(): boolean {
		return this.mode === "laser" || this.mode === "pen" || this.mode === "eraser";
	}

	/** Color del lápiz en esta sesión: el elegido en la barra o, si no, el del láser. */
	private penColor(): string {
		return this.plugin.penColor ?? this.plugin.settings.laserColor;
	}

	/**
	 * Avisa de cambios del láser o del lápiz (como mucho una vez por fotograma mientras se mueve
	 * el ratón). Lo escuchan este editor y la pantalla de jugadores.
	 */
	private scheduleDrawEmit(kind: "laser" | "pen"): void {
		this.drawDirty[kind] = true;
		if (this.drawFrame) return;
		this.drawFrame = this.mapEl.win.requestAnimationFrame(() => {
			this.drawFrame = 0;
			const path = this.file?.path;
			const dirty = this.drawDirty;
			this.drawDirty = { laser: false, pen: false };
			if (!path) return;
			if (dirty.laser) this.plugin.events.trigger("map-laser", path);
			if (dirty.pen) this.plugin.events.trigger("map-pen", path);
		});
	}

	private eventPt(e: MouseEvent): Pt | null {
		return this.map ? this.pt(this.map.mouseEventToLatLng(e)) : null;
	}

	/** Instala la capa y los manejadores de las herramientas de dibujo (una vez, al crear el mapa). */
	private setupDrawing(map: L.Map): void {
		const el = this.mapEl;
		this.drawLayer = new DrawingLayer(
			map,
			() => this.plugin.settings.laserFadeSeconds * 1000,
			() => this.plugin.settings.drawWidth,
		);
		const onControl = (e: Event) => {
			const t = e.target as Node | null;
			return !!t && t.instanceOf(HTMLElement) && !!t.closest(".leaflet-control");
		};
		// Con una herramienta de dibujo, el clic izquierdo no abre notas ni enseña vistas previas: se
		// cortan clic, doble clic y paso del ratón antes de que lleguen a marcadores, rutas y nodos.
		// El clic derecho (menús) sigue funcionando.
		for (const type of ["click", "dblclick", "mouseover"] as const)
			this.registerDomEvent(
				el,
				type,
				(e) => {
					if (this.isDrawMode() && !onControl(e)) e.stopPropagation();
				},
				{ capture: true },
			);
		this.registerDomEvent(
			el,
			"contextmenu",
			(e) => {
				if (!this.suppressContext) return;
				this.suppressContext = false;
				e.preventDefault();
				e.stopPropagation();
			},
			{ capture: true },
		);
		this.registerDomEvent(
			el,
			"pointerdown",
			(e) => {
				if (!onControl(e)) this.onDrawDown(e);
			},
			{ capture: true },
		);
		this.registerDomEvent(el, "pointermove", (e) => this.onDrawMove(e));
		this.registerDomEvent(el, "pointerup", (e) => this.onDrawUp(e));
		this.registerDomEvent(el, "pointercancel", (e) => this.onDrawUp(e));
		this.registerDomEvent(el, "pointerleave", () => {
			if (this.mode === "laser") this.setLaserPointer(null);
		});
		this.registerEvent(
			this.plugin.events.on("map-laser", (path) => {
				if (this.file && path === this.file.path) this.drawLayer?.setLaser(this.plugin.laserFor(this.file.path));
			}),
		);
		this.registerEvent(
			this.plugin.events.on("map-pen", (path) => {
				if (this.file && path === this.file.path) this.drawLayer?.setPen(this.plugin.penFor(this.file.path));
			}),
		);
	}

	/** Punto del láser (null = el cursor salió del mapa o se dejó el láser). */
	private setLaserPointer(p: Pt | null): void {
		const path = this.file?.path;
		if (!path) return;
		const st = this.plugin.laserFor(path);
		if (!p && !st.pointer) return;
		st.pointer = p;
		st.color = this.plugin.settings.laserColor;
		this.scheduleDrawEmit("laser");
	}

	private onDrawDown(e: PointerEvent): void {
		if (!this.isDrawMode() || !this.map || !this.file) return;
		if (e.button === 2) {
			this.startRightPan(e);
			return;
		}
		if (e.button !== 0) return;
		// Sin esto, el clic llegaría a los marcadores (arrastre) y al arrastre del mapa de Leaflet.
		e.preventDefault();
		e.stopPropagation();
		const p = this.eventPt(e);
		if (!p) return;
		this.mapEl.setPointerCapture(e.pointerId);
		const path = this.file.path;
		if (this.mode === "eraser") {
			this.drawing = { kind: "eraser", stroke: null, pointerId: e.pointerId };
			this.eraseAt(e);
			return;
		}
		const stroke: Stroke = {
			id: uid(),
			color: this.mode === "pen" ? this.penColor() : this.plugin.settings.laserColor,
			width: this.plugin.settings.drawWidth,
			points: [p],
		};
		if (this.mode === "laser") {
			const st = this.plugin.laserFor(path);
			const fade = this.plugin.settings.laserFadeSeconds * 1000;
			st.strokes = st.strokes.filter((s) => !laserStrokeExpired(s, fade));
			st.strokes.push(stroke);
			this.drawing = { kind: "laser", stroke, pointerId: e.pointerId };
			this.scheduleDrawEmit("laser");
		} else {
			this.plugin.penFor(path).push(stroke);
			this.drawing = { kind: "pen", stroke, pointerId: e.pointerId };
			this.scheduleDrawEmit("pen");
		}
	}

	private onDrawMove(e: PointerEvent): void {
		if (!this.isDrawMode()) return;
		const p = this.eventPt(e);
		if (!p) return;
		if (this.mode === "laser") this.setLaserPointer(p);
		const d = this.drawing;
		if (!d || d.pointerId !== e.pointerId) return;
		if (d.kind === "eraser") {
			this.eraseAt(e);
			return;
		}
		d.stroke?.points.push(p);
		this.scheduleDrawEmit(d.kind);
	}

	private onDrawUp(e: PointerEvent): void {
		const d = this.drawing;
		if (!d || d.pointerId !== e.pointerId) return;
		this.drawing = null;
		if (this.mapEl.hasPointerCapture(e.pointerId)) this.mapEl.releasePointerCapture(e.pointerId);
		if (d.kind === "laser" && d.stroke) {
			// Desde aquí, el trazo del láser se desvanece.
			d.stroke.releasedAt = Date.now();
			this.scheduleDrawEmit("laser");
		} else if (d.kind === "pen") this.scheduleDrawEmit("pen");
	}

	/** Borrador: quita los trazos del lápiz que pasan a menos de unos píxeles del cursor (trazos enteros). */
	private eraseAt(e: MouseEvent): void {
		const map = this.map;
		const path = this.file?.path;
		if (!map || !path) return;
		const c = map.mouseEventToContainerPoint(e);
		const strokes = this.plugin.penFor(path);
		const hit = (s: Stroke) => {
			const pts = s.points.map((p) => map.latLngToContainerPoint(this.ll(p)));
			if (pts.length === 1) return pts[0].distanceTo(c) <= MapView.ERASER_PX;
			for (let i = 0; i < pts.length - 1; i++) if (distToSegment(c, pts[i], pts[i + 1]) <= MapView.ERASER_PX) return true;
			return false;
		};
		const keep = strokes.filter((s) => !hit(s));
		if (keep.length === strokes.length) return;
		// Mismo array: es el que guarda el plugin.
		strokes.splice(0, strokes.length, ...keep);
		this.scheduleDrawEmit("pen");
	}

	private static readonly ERASER_PX = 10;

	/** «Borrar todos los dibujos» (clic derecho en el borrador): el lápiz y lo que quede del láser. */
	private clearDrawings(): void {
		const path = this.file?.path;
		if (!path) return;
		this.plugin.penFor(path).length = 0;
		this.plugin.laserFor(path).strokes = [];
		this.scheduleDrawEmit("pen");
		this.scheduleDrawEmit("laser");
	}

	/**
	 * Con una herramienta de dibujo, el mapa se mueve arrastrando con el botón derecho. Si se
	 * llegó a mover, se anula el menú contextual de ese clic; si no, sale el menú de siempre.
	 */
	private startRightPan(e: PointerEvent): void {
		const map = this.map;
		if (!map) return;
		const win = this.mapEl.win;
		const start = { x: e.clientX, y: e.clientY };
		let last = start;
		let moved = false;
		const move = (ev: PointerEvent) => {
			if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
			moved = true;
			map.panBy([last.x - ev.clientX, last.y - ev.clientY], { animate: false });
			last = { x: ev.clientX, y: ev.clientY };
		};
		const up = () => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", up);
			if (moved) this.suppressContext = true;
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", up);
	}

	// ---------- Pantalla de jugadores ----------

	/** ¿Se está mostrando este mapa en la pantalla de jugadores? */
	private isOnPlayerScreen(): boolean {
		const pc = this.plugin.playerContent;
		return !!this.file && pc?.kind === "map" && pc.path === this.file.path;
	}

	/**
	 * Marco de la vista de jugadores, en píxeles del contenedor del mapa: el mayor rectángulo
	 * con la proporción de su ventana (no su resolución) que cabe en tu vista, centrado.
	 * Sin pantalla de jugadores abierta, 16:9.
	 */
	private frameRect(): { x: number; y: number; w: number; h: number } | null {
		const W = this.mapEl.clientWidth;
		const H = this.mapEl.clientHeight;
		if (!W || !H) return null;
		const aspect = this.plugin.playerAspect() ?? 16 / 9;
		const w = W / H > aspect ? H * aspect : W;
		const h = w / aspect;
		return { x: (W - w) / 2, y: (H - h) / 2, w, h };
	}

	/** Región del mapa que hay dentro del marco. */
	private frameRegion(): MapRegion | null {
		const map = this.map;
		const f = this.frameRect();
		if (!map || !f) return null;
		const a = map.containerPointToLatLng([f.x, f.y]);
		const b = map.containerPointToLatLng([f.x + f.w, f.y + f.h]);
		return { south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat), west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng) };
	}

	/** Envía el mapa con lo que hay dentro del marco. Si ya está en la pantalla, la vista vuela allí. */
	private sendViewToPlayers(): void {
		if (!this.file || !this.map) return;
		void this.plugin.sendMapToPlayers(this.file.path, this.frameRegion(), this.isOnPlayerScreen());
	}

	private toggleLivePlayers(): void {
		this.livePlayers = !this.livePlayers;
		if (this.livePlayers) this.sendViewToPlayers();
		this.renderAll();
	}

	/** En tiempo real, cada movimiento de tu vista se envía (como mucho uno por fotograma). */
	private followLive(): void {
		if (!this.livePlayers || this.adapting || this.liveFrame || !this.isOnPlayerScreen()) return;
		this.liveFrame = window.requestAnimationFrame(() => {
			this.liveFrame = 0;
			const region = this.frameRegion();
			if (region && this.file && this.isOnPlayerScreen()) void this.plugin.sendMapToPlayers(this.file.path, region, false);
		});
	}

	/**
	 * Con el mapa en la pantalla de jugadores: el marco (lo que se enviaría; en tiempo real, lo
	 * que ven) y, si no es en tiempo real, el rectángulo de lo que ven ahora.
	 */
	private updatePlayerFrame(): void {
		const on = this.isOnPlayerScreen();
		if (!on) this.livePlayers = false;
		const show = on && this.plugin.settings.showPlayerFrame;
		const f = show ? this.frameRect() : null;
		if (f) {
			this.frameEl ??= this.mapEl.createDiv("strakes-player-frame");
			this.frameEl.setCssStyles({ left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
		} else {
			this.frameEl?.remove();
			this.frameEl = null;
		}
		this.playerRect?.remove();
		this.playerRect = null;
		const pc = this.plugin.playerContent;
		if (show && !this.livePlayers && this.map && pc?.kind === "map") {
			const bounds = pc.region ? regionBounds(pc.region) : this.bounds();
			// Línea del color de acento sobre un halo oscuro: se ve sobre cualquier fondo.
			this.playerRect = L.layerGroup([
				L.rectangle(bounds, { className: "strakes-player-rect-halo", interactive: false, fill: false, weight: 7 }),
				L.rectangle(bounds, { className: "strakes-player-rect", interactive: false, fill: false, weight: 3 }),
			]).addTo(this.map);
		}
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
		const panel = this.panelBodyEl;
		const data = this.mapData;
		// Al redibujar se conserva el desplazamiento (si no, volvería arriba con cada clic).
		const scroll = this.panelEl.scrollTop;
		panel.empty();
		this.panelEl.toggle(this.panelOpen);
		if (!data || !this.panelOpen) return;
		const q = this.filter.trim().toLowerCase();
		const match = (name: string) => !q || name.toLowerCase().includes(q);

		// Capas del usuario: cada pin o ruta puede estar en una o en ninguna.
		const layersSec = this.collapsibleSection(panel, "layers", T("Capas", "Layers"), data.layers.length, {
			icon: "plus",
			tip: T("Nueva capa", "New layer"),
			onClick: () => void this.addLayer(),
		});
		if (!data.layers.length)
			layersSec.createDiv({ cls: "strakes-panel-meta strakes-panel-empty", text: T("Sin capas. Crea una con + para agrupar marcadores y rutas.", "No layers. Create one with + to group markers and routes.") });
		for (const layer of data.layers.filter((l) => match(l.name))) {
			const row = layersSec.createDiv("strakes-panel-row strakes-layer-row");
			row.toggleClass("is-current", layer.id === this.currentLayerId);
			row.toggleClass("is-hidden", !layer.visible);
			this.visToggle(row, "dm", layer.visible, (v) => (layer.visible = v));
			this.visToggle(row, "players", layer.players === true, (v) => (layer.players = v || undefined));
			const nPins = data.pins.filter((p) => p.layerId === layer.id).length;
			const nRoutes = data.routes.filter((r) => r.layerId === layer.id).length;
			const nZones = data.zones.filter((z) => z.layerId === layer.id).length;
			const name = row.createDiv({ cls: "strakes-panel-name", text: layer.name });
			setTooltip(name, T("Clic para activarla: los marcadores y rutas nuevos se crearán en esta capa", "Click to make it active: new markers and routes will be created on this layer"));
			name.onclick = () => {
				this.currentLayerId = this.currentLayerId === layer.id ? null : layer.id;
				this.renderPanel();
			};
			row.createDiv({ cls: "strakes-panel-meta", text: `${nPins}📍 ${nRoutes}〰 ${nZones}⬠` });
			const more = row.createEl("button", { cls: "clickable-icon" });
			setIcon(more, "more-horizontal");
			more.onclick = (evt) => this.layerMenu(layer.id, evt);
		}

		// Marcadores. En la cabecera, los interruptores del tipo (todos los marcadores).
		const pinsSec = this.collapsibleSection(panel, "pins", T("Marcadores", "Markers"), data.pins.length, undefined, (tools) => {
			this.visToggle(tools, "dm", data.showPins, (v) => (data.showPins = v), T("todos los marcadores", "all markers"));
			this.visToggle(tools, "players", data.playerPins, (v) => (data.playerPins = v), T("todos los marcadores", "all markers"));
		});
		if (!data.pins.length) pinsSec.createDiv({ cls: "strakes-panel-meta strakes-panel-empty", text: T("Sin marcadores.", "No markers.") });
		for (const p of data.pins.filter((x) => match(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
			const row = pinsSec.createDiv("strakes-panel-row");
			row.toggleClass("is-hidden", p.hidden === true);
			this.visToggle(row, "dm", !p.hidden, (v) => (p.hidden = v ? undefined : true));
			this.visToggle(row, "players", p.players === true, (v) => (p.players = v || undefined));
			const sw = row.createDiv("strakes-swatch is-round");
			sw.setCssStyles({ background: p.color });
			row.createDiv({ cls: "strakes-panel-name", text: p.name });
			row.createDiv({ cls: "strakes-panel-meta", text: data.layers.find((l) => l.id === p.layerId)?.name ?? "" });
			row.onclick = () => this.map?.flyTo(this.ll(p), Math.max(this.map.getZoom(), 0), { duration: 0.6 });
			row.oncontextmenu = (evt) => this.pinMenu(p, evt);
		}

		// Rutas. En la cabecera, los interruptores del tipo (todas las rutas).
		const routesSec = this.collapsibleSection(panel, "routes", T("Rutas", "Routes"), data.routes.length, undefined, (tools) => {
			this.visToggle(tools, "dm", data.showRoutes, (v) => (data.showRoutes = v), T("todas las rutas", "all routes"));
			this.visToggle(tools, "players", data.playerRoutes, (v) => (data.playerRoutes = v), T("todas las rutas", "all routes"));
		});
		if (!data.routes.length) routesSec.createDiv({ cls: "strakes-panel-meta strakes-panel-empty", text: T("Sin rutas.", "No routes.") });
		const nodes = nodeMap(data);
		for (const r of data.routes.filter((x) => match(x.name))) {
			const row = routesSec.createDiv("strakes-panel-row");
			row.toggleClass("is-current", r.id === this.selectedRouteId);
			row.toggleClass("is-hidden", r.hidden === true);
			this.visToggle(row, "dm", !r.hidden, (v) => (r.hidden = v ? undefined : true));
			this.visToggle(row, "players", r.players === true, (v) => (r.players = v || undefined));
			const sw = row.createDiv("strakes-swatch");
			sw.setCssStyles({ background: r.color });
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

		// Zonas (1.3). En la cabecera, los interruptores del tipo (todas las zonas).
		const zonesSec = this.collapsibleSection(panel, "zones", T("Zonas", "Zones"), data.zones.length, undefined, (tools) => {
			this.visToggle(tools, "dm", data.showZones, (v) => (data.showZones = v), T("todas las zonas", "all zones"));
			this.visToggle(tools, "players", data.playerZones, (v) => (data.playerZones = v), T("todas las zonas", "all zones"));
		});
		if (!data.zones.length) zonesSec.createDiv({ cls: "strakes-panel-meta strakes-panel-empty", text: T("Sin zonas.", "No zones.") });
		for (const z of data.zones.filter((x) => match(x.name))) {
			const row = zonesSec.createDiv("strakes-panel-row");
			row.toggleClass("is-current", z.id === this.selectedZoneId);
			row.toggleClass("is-hidden", z.hidden === true);
			this.visToggle(row, "dm", !z.hidden, (v) => (z.hidden = v ? undefined : true));
			this.visToggle(row, "players", z.players === true, (v) => (z.players = v || undefined));
			const sw = row.createDiv("strakes-swatch");
			sw.setCssStyles({ background: z.color });
			row.createDiv({ cls: "strakes-panel-name", text: z.name.trim() || T("(sin nombre)", "(unnamed)") });
			const area = zoneArea(data, z);
			row.createDiv({ cls: "strakes-panel-meta", text: area ? displayArea(area.value, data.unit, this.plugin.settings.displayUnit) : "" });
			row.onclick = () => {
				const poly = this.zonePolygons.get(z.id);
				if (poly) this.map?.flyToBounds(poly.getBounds().pad(0.3), { duration: 0.5 });
			};
			row.oncontextmenu = (evt) => this.zoneMenu(z, evt);
		}

		// Escala
		const scaleSec = this.section(panel, T("Escala", "Scale"), "scale", T("Calibrar escala", "Calibrate scale"), () => this.setMode("calibrate"));
		scaleSec.createDiv({
			cls: "strakes-panel-meta",
			text: data.scale
				? `100 px = ${displayDistance(data.scale * 100, data.unit, this.plugin.settings.displayUnit)}`
				: T("Sin escala: escribe la distancia de cada tramo (clic en su etiqueta).", "No scale: enter the distance of each segment (click its label)."),
		});
		this.panelEl.scrollTop = scroll;
	}

	/**
	 * Botón con icono de ojo (vista del DM) o pantalla (jugadores), como el ojo de los
	 * combatientes: apagado, el icono sale tachado y en gris.
	 */
	private iconToggle(parent: HTMLElement, kind: "dm" | "players", on: boolean, tip: string, onClick: () => void): HTMLElement {
		const b = parent.createEl("button", { cls: "clickable-icon strakes-vis-toggle" });
		setIcon(b, kind === "dm" ? (on ? "eye" : "eye-off") : on ? "monitor" : "monitor-off");
		b.toggleClass("is-off", !on);
		setTooltip(b, tip);
		b.onclick = (e) => {
			e.stopPropagation();
			onClick();
		};
		return b;
	}

	/**
	 * Interruptor de visibilidad del panel: ojo = vista del DM, pantalla = jugadores. Cada clic se
	 * guarda en el mapa. `what` completa el tooltip de los interruptores de tipo («todas las rutas»).
	 */
	private visToggle(parent: HTMLElement, kind: "dm" | "players", on: boolean, set: (v: boolean) => void, what?: string): void {
		const tip =
			kind === "dm"
				? on
					? T("Visible en tu vista · clic para ocultar", "Visible in your view · click to hide")
					: T("Oculto en tu vista · clic para mostrar", "Hidden in your view · click to show")
				: on
					? T("Visible para los jugadores · clic para ocultar", "Visible to players · click to hide")
					: T("Oculto a los jugadores · clic para mostrar", "Hidden from players · click to show");
		this.iconToggle(parent, kind, on, what ? `${tip} (${what})` : tip, () => {
			set(!on);
			this.persist();
			this.renderAll();
		});
	}

	/**
	 * Sección de etiquetas de la barra: 🏷 | ojo (tus etiquetas) y pantalla (las de los jugadores).
	 * Los generales encienden o apagan todos los tipos a la vez (si alguno está encendido, los apagan).
	 * Clic derecho en la sección: cuadro con una fila por tipo; se recuerda si estaba desplegado.
	 * Nada de esto se guarda en el mapa (decisión del desarrollador: es circunstancial).
	 */
	private renderLabelTools(tb: HTMLElement): void {
		const sec = tb.createDiv("strakes-label-tools");
		const icon = sec.createSpan("strakes-label-icon");
		setIcon(icon, "tag");
		setTooltip(icon, T("Etiquetas · clic derecho para elegirlas por tipo", "Labels · right-click to choose them by type"));
		const dm = this.labels;
		const path = this.file?.path ?? "";
		const pl = this.plugin.playerLabels(path);
		const any = (s: LabelState) => s.pins || s.routes || s.zones;
		const setDm = (s: LabelState) => {
			this.labels = s;
			this.renderAll();
		};
		const setPl = (s: LabelState) => {
			if (path) this.plugin.setPlayerLabels(path, s);
		};
		const tip = (kind: "dm" | "players", on: boolean, what?: string) => {
			const base =
				kind === "dm"
					? on
						? T("Tus etiquetas visibles · clic para ocultarlas", "Your labels shown · click to hide them")
						: T("Tus etiquetas ocultas · clic para mostrarlas", "Your labels hidden · click to show them")
					: on
						? T("Etiquetas visibles para los jugadores · clic para ocultarlas", "Labels shown to players · click to hide them")
						: T("Etiquetas ocultas a los jugadores · clic para mostrarlas", "Labels hidden from players · click to show them");
			return what ? `${base} (${what})` : base;
		};
		this.iconToggle(sec, "dm", any(dm), tip("dm", any(dm)), () => {
			const v = !any(dm);
			setDm({ pins: v, routes: v, zones: v });
		});
		this.iconToggle(sec, "players", any(pl), tip("players", any(pl)), () => {
			const v = !any(pl);
			setPl({ pins: v, routes: v, zones: v });
		});
		sec.oncontextmenu = (e) => {
			e.preventDefault();
			this.plugin.settings.labelsMenuOpen = !this.plugin.settings.labelsMenuOpen;
			void this.plugin.saveSettings();
			this.renderToolbar();
		};
		if (!this.plugin.settings.labelsMenuOpen) return;
		const menu = sec.createDiv("strakes-label-menu");
		menu.oncontextmenu = (e) => e.stopPropagation();
		const row = (key: keyof LabelState, name: string, what: string) => {
			const r = menu.createDiv("strakes-label-row");
			r.createSpan({ cls: "strakes-label-name", text: name });
			this.iconToggle(r, "dm", dm[key], tip("dm", dm[key], what), () => setDm({ ...dm, [key]: !dm[key] }));
			this.iconToggle(r, "players", pl[key], tip("players", pl[key], what), () => setPl({ ...pl, [key]: !pl[key] }));
		};
		row("pins", T("Marcadores", "Markers"), T("nombres de los marcadores", "marker names"));
		row(
			"routes",
			T("Rutas", "Routes"),
			T("tú: número y ruta de cada tramo; jugadores: nombre de la ruta", "you: number and route of each segment; players: route name"),
		);
		row("zones", T("Zonas", "Zones"), T("nombres de las zonas", "zone names"));
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
		/** Botones extra de la cabecera (p. ej. los interruptores de visibilidad del tipo). */
		tools?: (el: HTMLElement) => void,
	): HTMLElement {
		const collapsed = this.plugin.settings.collapsedMapSections;
		const sec = parent.createDiv("strakes-panel-section is-collapsible");
		const head = sec.createDiv("strakes-panel-head");
		// Los interruptores del tipo, a la izquierda: en la misma columna que los de cada fila.
		if (tools) tools(head.createDiv("strakes-panel-tools"));
		const toggle = head.createDiv("strakes-panel-toggle");
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
		// La flecha de plegar, al otro extremo.
		const chevron = head.createDiv("strakes-panel-chevron clickable-icon");
		const body = sec.createDiv("strakes-panel-body");
		const apply = () => {
			const isCollapsed = collapsed.includes(key);
			sec.toggleClass("is-collapsed", isCollapsed);
			setIcon(chevron, isCollapsed ? "chevron-left" : "chevron-down");
			const tip = isCollapsed ? T("Desplegar", "Expand") : T("Plegar", "Collapse");
			setTooltip(toggle, tip);
			setTooltip(chevron, tip);
		};
		const flip = () => {
			const i = collapsed.indexOf(key);
			if (i >= 0) collapsed.splice(i, 1);
			else collapsed.push(key);
			void this.plugin.saveSettings();
			apply();
		};
		toggle.onclick = flip;
		chevron.onclick = flip;
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
		// La indicación y el resultado de Medir van en su panel, no aquí.
		const parts = [this.imageWarning, this.mode === "measure" ? "" : modeHint(this.mode), editHint].filter(Boolean);
		this.statusEl.setText(parts.join("  ·  "));
		this.statusEl.toggle(parts.length > 0);
	}

	// ---------- Modos ----------

	private setMode(mode: Mode): void {
		if (this.mode === "route" && mode !== "route") this.finishRoute();
		// Se sale de «elegir destino» sin elegirlo (Esc u otra herramienta): si el portal se
		// quedó sin nombre (AUTO sin destino todavía), se vuelve a abrir su diálogo.
		const abandoned = this.mode === "pick-target" && mode !== "pick-target" ? this.pickTargetPin : null;
		if (abandoned) this.pickTargetPin = null;
		this.mode = mode;
		if (mode !== "zone") {
			this.draftZone = [];
			this.showSnap(null);
		}
		this.measureFrom = null;
		this.calibrateFrom = null;
		if (mode !== "measure") this.overlay?.clearLayers();
		if (mode !== "measure") {
			this.measureMessage = "";
			this.lastMeasure = null;
			this.measurePoints = [];
		}
		this.map?.doubleClickZoom[mode === "navigate" ? "enable" : "disable"]();
		// Con las herramientas de dibujo, el arrastre izquierdo dibuja: el mapa se mueve con el derecho.
		this.map?.dragging[this.isDrawMode() ? "disable" : "enable"]();
		if (mode !== "laser") this.setLaserPointer(null);
		this.renderAll();
		if (abandoned) this.askNameIfMissing(abandoned);
	}

	/**
	 * Entra en modo ruta para empezar o extender otra ruta desde un menú. Si ya se estaba
	 * dibujando una, primero se termina (como al pulsar Enter), en lugar de seguir añadiendo
	 * nodos a esa.
	 */
	private startRouteMode(): void {
		if (this.mode === "route") this.finishRoute();
		this.setMode("route");
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
			case "zone":
				this.addZoneVertex(e.latlng);
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
				if (this.selectedRouteId || this.selectedZoneId) {
					this.selectedRouteId = null;
					this.selectedZoneId = null;
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
					this.startRouteMode();
					this.addRoutePoint(p);
				}),
		);
		m.addItem((i) =>
			i
				.setTitle(T("Empezar zona aquí", "Start zone here"))
				.setIcon("pentagon")
				.onClick(() => {
					this.setMode("zone");
					this.addZoneVertex(e.latlng);
				}),
		);
		m.showAtMouseEvent(e.originalEvent);
	}

	// ---------- Pines ----------

	/** Marcador nuevo en un punto; con `nodeId` (clic sobre un nodo), nace anclado a ese nodo. */
	private createPin(p: Pt, nodeId?: string): void {
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
			// Los marcadores nuevos toman el nombre automático; escribir uno lo desactiva.
			autoName: true,
			nodeId,
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
				// Los portales con AUTO que apuntan a este marcador toman su nombre nuevo.
				applyAutoNames(data.pins);
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
			case "route": {
				// Anclado: conecta con su nodo. Suelto: añade un nodo justo en la posición del pin.
				const node = this.anchorNode(pin);
				if (node) this.appendNode(this.ensureActiveRoute(), node.id);
				// Suelto: el nodo nuevo se crea en su punto y el marcador queda anclado a él.
				else this.addRoutePoint({ x: pin.x, y: pin.y }, this.autoAnchor ? pin : undefined);
				return;
			}
			case "zone":
				this.addZoneVertex(this.ll(pin));
				return;
			case "pick-target":
				if (this.pickTargetPin && this.pickTargetPin.id !== pin.id) {
					const portal = this.pickTargetPin;
					portal.targetPinId = pin.id;
					portal.target = undefined;
					this.pickTargetPin = null;
					if (this.mapData) applyAutoNames(this.mapData.pins);
					new Notice(T(`Portal / escalera enlazado con «${pin.name}»`, `Portal / stairs linked to "${pin.name}"`));
					this.persist();
					this.setMode("navigate");
					this.askNameIfMissing(portal);
				}
				return;
			case "measure": {
				// Anclado: cuenta como su nodo (se mide por las rutas).
				const node = this.anchorNode(pin);
				if (node) this.measurePick(node, node.id);
				else this.onMapClick({ latlng: this.ll(pin) } as L.LeafletMouseEvent);
				return;
			}
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

	/** Abre la nota enlazada de un marcador o una zona. */
	private async openPinLink(pin: { link?: string }, newTab: boolean | string): Promise<void> {
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

	/** Envía a la pantalla de jugadores la nota enlazada de un marcador o una zona. */
	private sendPinToPlayers(pin: { link?: string }): void {
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
		this.askNameIfMissing(pin);
	}

	/**
	 * Portal con AUTO al que no le salió nombre del destino elegido (un punto fijo o un
	 * marcador sin nombre propio): se vuelve a abrir su diálogo para ponérselo.
	 */
	private askNameIfMissing(pin: MapPin): void {
		if (!pin.name.trim()) this.openPinModal(pin, false);
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
		m.addItem((i) =>
			i
				.setTitle(pin.players ? T("Ocultar a los jugadores", "Hide from players") : T("Mostrar a los jugadores", "Show to players"))
				.setIcon(pin.players ? "monitor-off" : "monitor")
				.onClick(() => {
					pin.players = pin.players ? undefined : true;
					this.persist();
					this.renderAll();
				}),
		);
		this.addMoveToLayerItem(m, evt, pin);
		if (this.anchorNode(pin))
			m.addItem((i) =>
				i
					.setTitle(T("Desanclar del nodo", "Unanchor from node"))
					.setIcon("unlink")
					.onClick(() => {
						pin.nodeId = undefined;
						this.persist();
						this.renderAll();
					}),
			);
		m.addItem((i) =>
			i
				.setTitle(T("Duplicar", "Duplicate"))
				.setIcon("copy")
				.onClick(() => {
					// La copia, desplazada, nace suelta.
					const copy: MapPin = {
						...structuredClone(pin),
						id: uid(),
						x: pin.x + 20,
						y: pin.y - 20,
						name: T(`${pin.name} (copia)`, `${pin.name} (copy)`),
						autoName: undefined,
						nodeId: undefined,
					};
					this.mapData!.pins.push(copy);
					this.persist();
					this.renderAll();
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar", "Delete"))
				.setWarning(true)
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

	/** Nodo nuevo en un punto, añadido a la ruta activa; con `anchorPin`, ese marcador queda anclado a él. */
	private addRoutePoint(p: Pt, anchorPin?: MapPin): void {
		const data = this.mapData!;
		const node: RouteNode = { id: uid(), x: p.x, y: p.y };
		data.nodes.push(node);
		if (anchorPin) anchorPin.nodeId = node.id;
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
		// Zona a medias: sus lados y vértices; el primero, más grande cuando ya se puede cerrar.
		if (this.mode === "zone" && this.draftZone.length) {
			const pts = this.draftZone.map((p) => this.ll(p));
			if (pts.length > 1) L.polyline(pts, { color: DEFAULT_ZONE_COLOR, weight: 3, dashArray: "6 6", interactive: false }).addTo(layer);
			this.draftZone.forEach((p, i) =>
				L.circleMarker(this.ll(p), {
					radius: i === 0 && this.draftZone.length >= 3 ? 7 : 4,
					color: DEFAULT_ZONE_COLOR,
					fillColor: "#fff",
					fillOpacity: 1,
					interactive: false,
				}).addTo(layer),
			);
			return;
		}
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

	private finishRoute(): void {
		const data = this.mapData;
		const route = this.activeRoute();
		const wasNew = this.activeRouteIsNew;
		this.activeRouteId = null;
		this.activeRouteIsNew = false;
		this.extendAtStart = false;
		// Puntos de curva sin nodo final: se descartan.
		this.pendingBends = [];
		if (this.mode === "route") {
			this.mode = "navigate";
			this.map?.doubleClickZoom.enable();
		}
		if (data && route) {
			if (route.nodeIds.length < 2) {
				data.routes = data.routes.filter((r) => r.id !== route.id);
				pruneNodes(data);
			} else if (wasNew) {
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
		m.addItem((i) =>
			i
				.setTitle(route.players ? T("Ocultar a los jugadores", "Hide from players") : T("Mostrar a los jugadores", "Show to players"))
				.setIcon(route.players ? "monitor-off" : "monitor")
				.onClick(() => {
					route.players = route.players ? undefined : true;
					this.persist();
					this.renderAll();
				}),
		);
		this.addMoveToLayerItem(m, evt, route);
		const extend = (atStart: boolean) => {
			this.startRouteMode();
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
				.setWarning(true)
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
			case "zone":
				this.addZoneVertex(this.ll(node));
				return;
			case "pin":
				// El marcador nuevo nace anclado al nodo (si el anclaje automático está activado).
				this.createPin({ x: node.x, y: node.y }, this.autoAnchor && !this.nodeTaken(node.id) ? node.id : undefined);
				return;
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
					this.startRouteMode();
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
				.setWarning(true)
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
		return data.routes.filter((r) => !r.hidden && isItemVisible(data, "routes", r.layerId));
	}

	/**
	 * Clic con la herramienta Medir: el primero fija la salida; el segundo calcula. Entre dos
	 * nodos, el camino más corto y el más rápido por las rutas visibles (si coinciden, solo uno);
	 * entre dos puntos con escala, la línea recta. El resultado sale en el panel de Medir.
	 */
	private measurePick(p: Pt, nodeId?: string): void {
		const data = this.mapData!;
		if (!this.measureFrom) {
			this.measureFrom = { pt: { x: p.x, y: p.y }, nodeId };
			this.measurePoints = [{ x: p.x, y: p.y }];
			this.lastMeasure = null;
			this.measureMessage = T("Elige el punto de llegada…", "Choose the end point…");
			this.drawMeasure();
			this.renderAll();
			return;
		}
		const from = this.measureFrom;
		this.measureFrom = null;
		this.measurePoints = [from.pt, { x: p.x, y: p.y }];
		this.lastMeasure = null;
		this.measureMessage = "";
		if (from.nodeId && nodeId) {
			const routes = this.visibleRoutes();
			const shortest = shortestPath(data, routes, from.nodeId, nodeId);
			if (!shortest) {
				this.measureMessage = T("No hay camino entre esos nodos por las rutas visibles.", "There's no path between those nodes along the visible routes.");
			} else {
				const fastest = fastestPath(data, routes, from.nodeId, nodeId);
				this.lastMeasure = { kind: "path", shortest, fastest: fastest && !samePath(shortest, fastest) ? fastest : null, show: "shortest" };
			}
		} else if (data.scale) {
			this.lastMeasure = { kind: "line", from: from.pt, to: { x: p.x, y: p.y }, distance: pixelDistance(from.pt, p) * data.scale };
		} else {
			this.measureMessage = T(
				"Mapa sin escala: mide entre dos nodos de ruta, o calibra la escala para medir en línea recta.",
				"Map without scale: measure between two route nodes, or calibrate the scale to measure in a straight line.",
			);
		}
		this.drawMeasure();
		this.renderAll();
	}

	/** Dibuja en el mapa la medición: los puntos y el camino elegido en el panel (o la línea recta). */
	private drawMeasure(): void {
		const overlay = this.overlay;
		const data = this.mapData;
		if (!overlay || !data) return;
		overlay.clearLayers();
		const m = this.lastMeasure;
		if (m?.kind === "path") {
			const res = m.show === "fastest" && m.fastest ? m.fastest : m.shortest;
			L.polyline(
				pathGeometry(data, res).map((n) => this.ll(n)),
				{ className: "strakes-measure-line", weight: 8, interactive: false },
			).addTo(overlay);
		} else if (m?.kind === "line") {
			L.polyline([this.ll(m.from), this.ll(m.to)], { className: "strakes-measure-line is-straight", weight: 4, interactive: false }).addTo(overlay);
		}
		for (const pt of this.measurePoints) L.circleMarker(this.ll(pt), { radius: 8, className: "strakes-measure-point", interactive: false }).addTo(overlay);
	}

	/**
	 * Panel de Medir, debajo de su botón: el paso de viaje y el resultado. Si el camino más corto y
	 * el más rápido son distintos, dos filas; la elegida (por defecto, la más corta) se resalta en
	 * el mapa. Los textos se recalculan al cambiar de paso o de unidad, sin volver a medir.
	 */
	private renderMeasurePanel(panel: HTMLElement): void {
		const data = this.mapData;
		if (!data) return;
		const pace = this.plugin.settings.travelPace;
		// Paso del viaje: cambia el tiempo calculado (se recuerda entre sesiones).
		const seg = panel.createDiv("strakes-segmented strakes-pace");
		for (const p of Object.keys(PACES) as Pace[]) {
			const b = seg.createEl("button", { text: PACES[p].label });
			b.toggleClass("is-active", pace === p);
			const perDay = PACES[p].hoursPerDay.toLocaleString(numberLocale());
			// Velocidad en la unidad elegida para mostrar (en millas con «Las de cada mapa»).
			const display = this.plugin.settings.displayUnit;
			const perUnit = display === "map" ? null : milesPerUnit(display);
			const speed =
				perUnit === null || perUnit === 1
					? T(`${PACES[p].mph} millas/h`, `${PACES[p].mph} miles/h`)
					: `${(PACES[p].mph / perUnit).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} ${display}/h`;
			setTooltip(b, T(`${speed} · ${perDay} h de marcha al día`, `${speed} · ${perDay} h of travel per day`));
			b.onclick = () => {
				this.plugin.settings.travelPace = p;
				void this.plugin.saveSettings();
				this.renderAll();
			};
		}

		const m = this.lastMeasure;
		if (!m) {
			panel.createDiv({ cls: "strakes-measure-hint", text: this.measureMessage || modeHint("measure") });
			return;
		}
		const row = (title: string | null, dist: string, time: string, choice?: { selected: boolean; pick: () => void }) => {
			const r = panel.createDiv("strakes-measure-row");
			if (title) r.createDiv({ cls: "strakes-measure-title", text: title });
			r.createDiv({ text: dist });
			r.createDiv({ cls: "strakes-measure-time", text: time });
			if (!choice) return;
			r.addClass("is-choice");
			r.toggleClass("is-selected", choice.selected);
			setTooltip(r, T("Clic para verlo en el mapa", "Click to see it on the map"));
			r.onclick = () => {
				choice.pick();
				this.drawMeasure();
				this.renderToolbar();
			};
		};

		if (m.kind === "line") {
			const t = distanceTime(data, m.distance, pace);
			const time =
				t === null
					? T(`Sin tiempo (la unidad «${data.unit}» no es de longitud)`, `No time (the unit "${data.unit}" isn't a length)`)
					: formatTravelTime(t, pace);
			row(T("Línea recta", "Straight line"), displayDistance(m.distance, data.unit, this.plugin.settings.displayUnit), time);
			return;
		}
		const shortest = this.pathTexts(m.shortest, pace);
		if (!m.fastest) {
			row(null, shortest.dist, shortest.time);
			return;
		}
		const fastest = this.pathTexts(m.fastest, pace);
		row(T("Más corta", "Shortest"), shortest.dist, shortest.time, { selected: m.show === "shortest", pick: () => (m.show = "shortest") });
		row(T("Más rápida", "Fastest"), fastest.dist, fastest.time, { selected: m.show === "fastest", pick: () => (m.show = "fastest") });
	}

	/** Distancia (con los tramos sin distancia) y tiempo de viaje de un camino, al paso indicado. */
	private pathTexts(res: PathResult, pace: Pace): { dist: string; time: string } {
		const data = this.mapData!;
		const segs = (n: number) => {
			const s = n > 1 ? "s" : "";
			return T(`${n} tramo${s}`, `${n} segment${s}`);
		};
		const extra = res.unknown ? T(` (+ ${segs(res.unknown)} sin distancia)`, ` (+ ${segs(res.unknown)} without distance)`) : "";
		const dist = `${displayDistance(res.distance, data.unit, this.plugin.settings.displayUnit)}${extra} · ${segs(res.legs.length)}`;
		const t = legsTime(data, res.legs, pace);
		const time =
			t.unknown === res.legs.length
				? T("Sin tiempo (añade tiempos a los tramos o usa una unidad de longitud)", "No time (add times to the segments or use a length unit)")
				: formatTravelTime(t.hours, pace) + (t.unknown ? T(` + ${segs(t.unknown)} sin tiempo`, ` + ${segs(t.unknown)} without time`) : "");
		return { dist, time };
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
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(T("Eliminar capa…", "Delete layer…"))
				.setWarning(true)
				.setIcon("trash-2")
				.onClick(async () => {
					const nP = data.pins.filter((p) => p.layerId === layerId).length;
					const nR = data.routes.filter((r) => r.layerId === layerId).length;
					const nZ = data.zones.filter((z) => z.layerId === layerId).length;
					const ok =
						nP + nR + nZ === 0 ||
						(await confirmDialog(
							this.app,
							T("Eliminar capa", "Delete layer"),
							T(
								`La capa «${layer.name}» tiene ${nP} marcadores, ${nR} rutas y ${nZ} zonas. Quedarán sin capa (no se eliminan).`,
								`The layer "${layer.name}" has ${nP} markers, ${nR} routes and ${nZ} zones. They'll be left without a layer (they aren't deleted).`,
							),
							T("Eliminar capa", "Delete layer"),
						));
					if (!ok) return;
					for (const p of data.pins) if (p.layerId === layerId) p.layerId = null;
					for (const r of data.routes) if (r.layerId === layerId) r.layerId = null;
					for (const z of data.zones) if (z.layerId === layerId) z.layerId = null;
					data.layers = data.layers.filter((l) => l.id !== layerId);
					if (this.currentLayerId === layerId) this.currentLayerId = null;
					this.persist();
					this.renderAll();
				}),
		);
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
				this.persist();
				void this.refresh();
			},
			() => this.setMode("calibrate"),
		).open();
	}
}
