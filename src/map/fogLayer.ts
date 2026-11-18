import * as L from "leaflet";
import { Pt } from "./geometry";
import { FogStroke, FogZone, MapFog } from "./fogData";

const toLatLng = (p: Pt): L.LatLng => L.latLng(p.y, p.x);

/** Panel de Leaflet de la niebla: por encima de imagen, zonas y rutas (400), por debajo de los marcadores (600). */
const FOG_PANE = "strakes-fog";
let maskCount = 0;

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

	constructor(
		private map: L.Map,
		/** Opacidad de la niebla: 1 para los jugadores, menos para el DM. */
		private opacity: number,
	) {
		if (!map.getPane(FOG_PANE)) map.createPane(FOG_PANE).addClass("strakes-fog-pane");
		this.renderer = L.svg({ pane: FOG_PANE, padding: 0.5 });
		this.group.addTo(map);
		map.on("zoomend", this.updateWeights);
	}

	/**
	 * Vuelve a dibujar la niebla (sin niebla o desactivada, nada). `bounds`: los de la imagen. Las
	 * zonas con la casilla «Niebla» marcada van encima de los trazos, cubiertas: el pincel no las descubre.
	 */
	set(fog: MapFog | undefined, bounds: L.LatLngBounds, zones: readonly FogZone[] = []): void {
		this.clear();
		if (!fog?.enabled) return;
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
			const poly = this.fillPolygon(z.points, "#ffffff");
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

	/** Polígono relleno de la máscara (zona, o trazo de polígono): negro = descubierto, blanco = cubierto. */
	private fillPolygon(points: readonly Pt[], color: string): L.Polygon {
		return L.polygon(
			points.map((p) => toLatLng(p)),
			{ renderer: this.renderer, stroke: false, fillColor: color, fillOpacity: 1, interactive: false },
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
