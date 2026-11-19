import * as L from "leaflet";
import { Pt } from "./geometry";
import { FogStroke, FogZone, MapFog } from "./fogData";

const toLatLng = (p: Pt): L.LatLng => L.latLng(p.y, p.x);

/** Panel de Leaflet de la niebla: por encima de imagen, zonas y rutas (400), por debajo de los marcadores (600). */
const FOG_PANE = "strakes-fog";
let maskCount = 0;
/**
 * Borde (px de pantalla) de las zonas marcadas en la máscara: las ensancha 1 px hacia fuera. Sin él,
 * entre dos zonas contiguas el suavizado de los bordes deja una línea fina descubierta.
 */
const ZONE_EDGE = 2;

/** Lo interno del renderizador SVG de Leaflet 1.9 que usa `FullMapSVG`. */
interface SvgInternals {
	_map: L.Map & { _animatingZoom?: boolean; _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point };
	/** El `<svg>` (Leaflet lo tipa y lo coloca como HTMLElement). */
	_container: HTMLElement;
	_bounds?: L.Bounds;
	_center: L.LatLng;
	_zoom: number;
	_svgSize?: L.Point;
	options: { padding: number };
	fire(type: string): void;
	/** Límites de la imagen del mapa: el SVG los abarca siempre (null: solo la vista). */
	_mapBounds: L.LatLngBounds | null;
	/** Origen de píxeles del mapa en el último `_update` (para colocar el SVG al hacer zoom). */
	_origin: L.Point;
}

/**
 * Renderizador SVG que abarca siempre la imagen entera del mapa, además de la vista con su margen.
 * El de Leaflet solo abarca la vista más un margen y, durante un zoom animado o un `flyTo`, escala lo
 * ya dibujado sin redibujarlo hasta el final: al alejarse, por un instante se veía el mapa sin niebla.
 * Copia `L.SVG._update` y `L.Renderer._updateTransform` (Leaflet 1.9.4) con estos límites.
 */
const FullMapSVG = (L.SVG as unknown as { extend(props: object): new (options: L.RendererOptions) => L.SVG }).extend({
	_mapBounds: null,
	_update(this: SvgInternals): void {
		const map = this._map;
		if (map._animatingZoom && this._bounds) return;
		const p = this.options.padding;
		const size = map.getSize();
		const min = map.containerPointToLayerPoint(size.multiplyBy(-p)).round();
		const b = L.bounds(min, min.add(size.multiplyBy(1 + p * 2)).round());
		if (this._mapBounds) {
			b.extend(map.latLngToLayerPoint(this._mapBounds.getNorthWest()).floor());
			b.extend(map.latLngToLayerPoint(this._mapBounds.getSouthEast()).ceil());
		}
		this._bounds = b;
		this._center = map.getCenter();
		this._zoom = map.getZoom();
		this._origin = map.getPixelOrigin();
		const s = b.getSize();
		const svg = this._container;
		if (!b.min) return;
		if (!this._svgSize || !this._svgSize.equals(s)) {
			this._svgSize = s;
			svg.setAttribute("width", String(s.x));
			svg.setAttribute("height", String(s.y));
		}
		L.DomUtil.setPosition(svg, b.min);
		svg.setAttribute("viewBox", [b.min.x, b.min.y, s.x, s.y].join(" "));
		this.fire("update");
	},
	// Durante el zoom: la esquina del SVG (en píxeles absolutos del último `_update`) escalada y
	// pasada al origen nuevo. Con solo la vista da lo mismo que el cálculo de Leaflet.
	_updateTransform(this: SvgInternals, center: L.LatLng, zoom: number): void {
		const map = this._map;
		const min = this._bounds?.min;
		if (!min) return;
		const scale = map.getZoomScale(zoom, this._zoom);
		const topLeft = min.add(this._origin).multiplyBy(scale).subtract(map._getNewPixelOrigin(center, zoom));
		if (L.Browser.any3d) L.DomUtil.setTransform(this._container, topLeft, scale);
		else L.DomUtil.setPosition(this._container, topLeft);
	},
});

/**
 * Dibuja la niebla de un mapa: un rectángulo del color de la niebla sobre la imagen, con una
 * máscara SVG en la que cada trazo, en orden, abre un hueco (negro) o lo vuelve a tapar (blanco).
 * Los trazos son polilíneas de Leaflet del mismo renderizador SVG que el rectángulo, movidas dentro
 * de la máscara: Leaflet las sigue recolocando al moverse o hacer zoom. Su grosor se guarda en
 * píxeles de la imagen y se recalcula al cambiar de zoom.
 * La usan el editor y los incrustados (semitransparente, vista del DM) y la pantalla de jugadores (opaca).
 */
export class FogLayer {
	private renderer: L.SVG;
	private group = L.layerGroup();
	private mask: SVGMaskElement | null = null;
	private strokes: { line: L.Polyline; stroke: FogStroke }[] = [];
	/** Primer elemento de las zonas en la máscara: los trazos nuevos van antes (manda la zona). */
	private zonesStart: Element | null = null;
	/** Niebla pedida antes de que el mapa tuviera vista: se dibuja en cuanto la tenga. */
	private pending: [MapFog, L.LatLngBounds, readonly FogZone[]] | null = null;

	constructor(
		private map: L.Map,
		/** Opacidad de la niebla: 1 para los jugadores, menos para el DM. */
		private opacity: number,
	) {
		if (!map.getPane(FOG_PANE)) map.createPane(FOG_PANE).addClass("strakes-fog-pane");
		this.renderer = new FullMapSVG({ pane: FOG_PANE, padding: 0.5 });
		this.group.addTo(map);
		map.on("zoomend", this.updateWeights);
	}

	/**
	 * Vuelve a dibujar la niebla (sin niebla o desactivada, nada). `bounds`: los de la imagen. Las
	 * zonas con la casilla «Niebla» marcada van encima de los trazos, cubiertas: el pincel no las descubre.
	 */
	set(fog: MapFog | undefined, bounds: L.LatLngBounds, zones: readonly FogZone[] = []): void {
		this.clear();
		if (!fog?.enabled) {
			this.pending = null;
			return;
		}
		// Sin vista, Leaflet aplaza las capas y la máscara no se podría crear: el rectángulo de la
		// niebla aparecería después sin ella y lo taparía todo. Se espera a que el mapa tenga vista
		// (con la última niebla pedida).
		if (!(this.map as unknown as { _loaded?: boolean })._loaded) {
			const waiting = this.pending !== null;
			this.pending = [fog, bounds, zones];
			if (!waiting)
				this.map.whenReady(() => {
					const p = this.pending;
					this.pending = null;
					if (p) this.set(...p);
				});
			return;
		}
		// El SVG abarca la imagen entera: la niebla tapa todo el mapa aunque no se vea.
		const internals = this.renderer as unknown as SvgInternals & { _update(): void };
		internals._mapBounds = bounds;
		if (this.map.hasLayer(this.renderer)) internals._update();
		const cover = L.rectangle(bounds, { renderer: this.renderer, stroke: false, fillColor: fog.color, fillOpacity: this.opacity, interactive: false });
		this.group.addLayer(cover);
		const svg = (this.renderer as unknown as { _container?: SVGSVGElement })._container;
		const coverEl = cover.getElement();
		if (!svg || !coverEl) return;
		const ns = "http://www.w3.org/2000/svg";
		const defs = svg.querySelector(":scope > defs") ?? svg.insertBefore(svg.ownerDocument.createElementNS(ns, "defs"), svg.firstChild);
		const mask = svg.ownerDocument.createElementNS(ns, "mask");
		const id = `strakes-fog-mask-${++maskCount}`;
		mask.setAttribute("id", id);
		mask.setAttribute("maskUnits", "userSpaceOnUse");
		for (const [k, v] of [["x", "-10000000"], ["y", "-10000000"], ["width", "20000000"], ["height", "20000000"]]) mask.setAttribute(k, v);
		defs.appendChild(mask);
		this.mask = mask;
		coverEl.setAttribute("mask", `url(#${id})`);
		// Base blanca de la máscara: todo cubierto.
		this.intoMask(L.rectangle(bounds, { renderer: this.renderer, stroke: false, fillColor: "#ffffff", fillOpacity: 1, interactive: false }));
		for (const s of fog.strokes) this.appendStroke(s);
		for (const z of zones) {
			if (z.fog !== true || z.points.length < 3) continue;
			const poly = this.fillPolygon(z.points, "#ffffff", ZONE_EDGE);
			// Las zonas, al final y en su orden (no delante de la primera: un trazo pintado después se
			// colocaría entre dos zonas y quedaría por encima de las siguientes).
			this.intoMask(poly, true);
			this.zonesStart ??= poly.getElement() ?? null;
		}
	}

	/** Añade un trazo detrás de los anteriores y antes de las zonas (mientras se pinta, sin redibujar todo). */
	appendStroke(stroke: FogStroke): void {
		if (!this.mask) return;
		if (stroke.polygon) {
			this.intoMask(this.fillPolygon(stroke.points, stroke.mode === "reveal" ? "#000000" : "#ffffff"));
			return;
		}
		const line = L.polyline(this.latLngs(stroke), {
			renderer: this.renderer,
			color: stroke.mode === "reveal" ? "#000000" : "#ffffff",
			opacity: 1,
			weight: this.weightOf(stroke),
			lineCap: "round",
			lineJoin: "round",
			fill: false,
			interactive: false,
			// Sin simplificar ni recortar: un trazo de un solo punto (un clic) se dibuja como un círculo.
			smoothFactor: 0,
			noClip: true,
		});
		this.intoMask(line);
		this.strokes.push({ line, stroke });
	}

	/** El último trazo cambió (se está pintando): actualiza sus puntos. */
	updateLastStroke(): void {
		const last = this.strokes[this.strokes.length - 1];
		if (last) last.line.setLatLngs(this.latLngs(last.stroke));
	}

	remove(): void {
		this.pending = null;
		this.clear();
		this.group.remove();
		this.map.off("zoomend", this.updateWeights);
	}

	private clear(): void {
		this.group.clearLayers();
		this.strokes = [];
		this.zonesStart = null;
		this.mask?.remove();
		this.mask = null;
	}

	/** Mete un elemento en la máscara: los trazos, antes de todas las zonas; las zonas (`atEnd`) y la base, al final. */
	private intoMask(layer: L.Path, atEnd = false): void {
		this.group.addLayer(layer);
		const el = layer.getElement();
		if (!el || !this.mask) return;
		if (!atEnd && this.zonesStart && this.zonesStart.parentNode === this.mask) this.mask.insertBefore(el, this.zonesStart);
		else this.mask.appendChild(el);
	}

	/**
	 * Polígono relleno de la máscara (zona, o trazo de polígono): negro = descubierto, blanco = cubierto.
	 * `edge`: grosor (px de pantalla) de un borde del mismo color que lo ensancha hacia fuera la mitad.
	 */
	private fillPolygon(points: readonly Pt[], color: string, edge = 0): L.Polygon {
		return L.polygon(
			points.map((p) => toLatLng(p)),
			{
				renderer: this.renderer,
				stroke: edge > 0,
				color,
				weight: edge,
				opacity: 1,
				lineJoin: "round",
				fillColor: color,
				fillOpacity: 1,
				interactive: false,
			},
		);
	}

	/** Un solo punto: dos iguales, para que la línea con extremos redondos se vea como un círculo. */
	private latLngs(stroke: FogStroke): L.LatLng[] {
		const pts = stroke.points.map((p) => toLatLng(p));
		return pts.length === 1 ? [pts[0], pts[0]] : pts;
	}

	/** Grosor en pantalla: el del trazo (píxeles de la imagen) por la escala del zoom actual. */
	private weightOf(stroke: FogStroke): number {
		return stroke.width * this.map.options.crs!.scale(this.map.getZoom());
	}

	/** Al cambiar de zoom, el grosor en pantalla de cada trazo (función flecha: se pasa a map.on/off). */
	private updateWeights = (): void => {
		for (const { line, stroke } of this.strokes) line.setStyle({ weight: this.weightOf(stroke) });
	};
}
