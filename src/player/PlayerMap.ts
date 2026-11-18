import * as L from "leaflet";
import { Component, TFile } from "obsidian";
import type StrakesTTRPG from "../main";
import { DrawingLayer } from "../map/drawing";
import { isPlayerVisible, MapData, newMapUnit, nodeMap, normalizeMap, ROUTE_COLORS, routePath } from "../map/mapData";
import { ensureZonePane, mapBounds, nodeMarker, pinIcon, pinTooltipOptions, routeNameLabel, toLatLng, zoneNameLabel, zoneStyle } from "../map/render";
import { MapRegion } from "../types";
import { resizeObserverFor } from "../ui/dom";

/** Límites de Leaflet de una región guardada. */
export function regionBounds(r: MapRegion): L.LatLngBounds {
	return L.latLngBounds([r.south, r.west], [r.north, r.east]);
}

/**
 * Mapa en la pantalla de jugadores. Solo dibuja lo visible para jugadores (ver
 * `isPlayerVisible`) y no tiene interacción: la vista la decide el DM desde el editor, que
 * envía la región que deben ver (`PlayerContent.region`; null = el mapa entero).
 *  - Al cambiar el tamaño de la ventana se sigue viendo la región entera.
 *  - Se actualiza al momento con cada cambio del editor (evento "map-data") y, si el archivo
 *    cambia por otro lado, al guardarse.
 * En la ventana emergente no funcionan ni la rueda ni el arrastre de Leaflet (escucha en el
 * `document` de la ventana principal), pero no hacen falta: los jugadores no lo tocan.
 */
export class PlayerMap extends Component {
	private map: L.Map | null = null;
	private data: MapData | null = null;
	private content: L.LayerGroup | null = null;
	private imageOverlay: L.ImageOverlay | null = null;
	private imageKey = "";
	private fitted = false;

	constructor(
		private plugin: StrakesTTRPG,
		private el: HTMLElement,
		private file: TFile,
	) {
		super();
	}

	onload(): void {
		const map = L.map(this.el, {
			crs: L.CRS.Simple,
			minZoom: -8,
			maxZoom: 6,
			// Sin redondeo: la región se encuadra exacta.
			zoomSnap: 0,
			zoomControl: false,
			attributionControl: false,
			dragging: false,
			scrollWheelZoom: false,
			doubleClickZoom: false,
			boxZoom: false,
			keyboard: false,
			touchZoom: false,
		});
		this.map = map;
		this.content = L.layerGroup().addTo(map);
		ensureZonePane(map);
		// Láser y lápiz del DM, en el mismo punto del mapa que en su editor.
		const drawing = new DrawingLayer(
			map,
			() => this.plugin.settings.laserFadeSeconds * 1000,
			() => this.plugin.settings.drawWidth,
		);
		this.register(() => drawing.remove());
		drawing.setPen(this.plugin.penFor(this.file.path));
		drawing.setLaser(this.plugin.laserFor(this.file.path));
		this.registerEvent(
			this.plugin.events.on("map-pen", (path) => {
				if (path === this.file.path) drawing.setPen(this.plugin.penFor(this.file.path));
			}),
		);
		this.registerEvent(
			this.plugin.events.on("map-laser", (path) => {
				if (path === this.file.path) drawing.setLaser(this.plugin.laserFor(this.file.path));
			}),
		);
		this.register(() => {
			map.remove();
			this.map = null;
		});

		const ro = resizeObserverFor(this.el, () => {
			map.invalidateSize({ pan: false });
			this.applyRegion(false);
		});
		ro.observe(this.el);
		this.register(() => ro.disconnect());

		// Cambios hechos en el editor: llegan antes de que se guarde el archivo.
		this.registerEvent(
			this.plugin.events.on("map-data", (path, data) => {
				if (path !== this.file.path || !data) return;
				this.data = normalizeMap(JSON.parse(JSON.stringify(data)));
				this.render();
			}),
		);
		this.registerEvent(
			this.plugin.app.vault.on("modify", (f) => {
				if (f === this.file) void this.readMap();
			}),
		);
		// Ajustes (p. ej. la transparencia del relleno de las zonas).
		this.registerEvent(this.plugin.events.on("settings", () => this.render()));
		// El DM cambió las etiquetas de los jugadores de este mapa.
		this.registerEvent(
			this.plugin.events.on("player-labels", (path) => {
				if (path === this.file.path) this.render();
			}),
		);
		// El DM envió otra región: con animación si la pidió con «Enviar esta vista».
		this.registerEvent(this.plugin.events.on("player-map-view", (animate) => this.applyRegion(animate === true)));

		void this.readMap();
	}

	private async readMap(): Promise<void> {
		try {
			this.data = normalizeMap(JSON.parse(await this.plugin.app.vault.cachedRead(this.file)), newMapUnit(this.plugin.settings.displayUnit));
		} catch {
			return; // Archivo dañado: se queda lo que había.
		}
		this.render();
	}

	private render(): void {
		const { data, map, content } = this;
		if (!data || !map || !content) return;

		const key = `${data.image}|${data.width}x${data.height}`;
		if (key !== this.imageKey) {
			this.imageOverlay?.remove();
			this.imageOverlay = null;
			this.imageKey = key;
			const img = this.plugin.app.vault.getAbstractFileByPath(data.image);
			if (img instanceof TFile && data.width && data.height)
				// La imagen va en el panel más bajo de Leaflet: por encima quedan zonas, rutas y marcadores.
				this.imageOverlay = L.imageOverlay(this.plugin.app.vault.getResourcePath(img), mapBounds(data), { interactive: false, pane: "tilePane" })
					.addTo(map)
					.bringToBack();
		}

		content.clearLayers();
		const labels = this.plugin.playerLabels(this.file.path);
		// Zonas visibles para los jugadores, por debajo de rutas y marcadores.
		for (const zone of data.zones) {
			if (!isPlayerVisible(data, "zones", zone)) continue;
			content.addLayer(L.polygon(zone.points.map((p) => toLatLng(p)), { ...zoneStyle(zone, this.plugin.settings.zoneFillTransparency), interactive: false }));
			if (labels.zones) {
				const label = zoneNameLabel(zone);
				if (label) content.addLayer(label);
			}
		}
		const nodes = nodeMap(data);
		for (const route of data.routes) {
			if (!isPlayerVisible(data, "routes", route)) continue;
			const line = L.polyline(
				routePath(route, nodes).map((p) => toLatLng(p)),
				{ color: route.color || ROUTE_COLORS[0], weight: 4, opacity: 0.9, interactive: false },
			);
			content.addLayer(line);
			for (const id of route.nodeIds) {
				const n = nodes.get(id);
				if (n) content.addLayer(nodeMarker(n, route.color, { draggable: false, interactive: false }));
			}
			if (labels.routes) {
				const label = routeNameLabel(route, nodes);
				if (label) content.addLayer(label);
			}
		}
		for (const pin of data.pins) {
			if (!isPlayerVisible(data, "pins", pin)) continue;
			const marker = L.marker(toLatLng(pin), { icon: pinIcon(pin), interactive: false, keyboard: false });
			if (labels.pins && pin.name.trim()) marker.bindTooltip(pin.name, pinTooltipOptions(pin, true));
			content.addLayer(marker);
		}

		if (!this.fitted) this.applyRegion(false);
	}

	/** Encuadra la región que envió el DM (o el mapa entero). */
	private applyRegion(animate: boolean): void {
		const { map, data } = this;
		if (!map || !data || !data.width || !data.height || !this.el.clientWidth || !this.el.clientHeight) return;
		this.fitted = true;
		const pc = this.plugin.playerContent;
		const region = pc && pc.kind === "map" && pc.path === this.file.path ? pc.region : null;
		const bounds = region ? regionBounds(region) : mapBounds(data);
		if (animate) map.flyToBounds(bounds, { duration: 0.8 });
		else map.fitBounds(bounds, { animate: false });
	}
}
