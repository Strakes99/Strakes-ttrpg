import * as L from "leaflet";
import { Pt } from "./geometry";
import { toLatLng } from "./render";

/** Trazo dibujado con el láser o el lápiz, en coordenadas del mapa. */
export interface Stroke {
	id: string;
	color: string;
	/** Grosor en píxeles, el del ajuste al dibujarlo (cambiar el ajuste no cambia los trazos que ya existen). */
	width: number;
	points: Pt[];
	/** Solo láser: momento (Date.now) en que se soltó el clic; desde ahí se desvanece. */
	releasedAt?: number;
}

/** Láser de un mapa: el punto que sigue al cursor del DM y los trazos que se desvanecen. */
export interface LaserState {
	pointer: Pt | null;
	color: string;
	strokes: Stroke[];
}

/** ¿El trazo del láser ya se desvaneció del todo? */
export function laserStrokeExpired(s: Stroke, fadeMs: number, now = Date.now()): boolean {
	return s.releasedAt !== undefined && now - s.releasedAt >= fadeMs;
}

/** Panel propio, por encima de rutas y marcadores y sin recibir el ratón. */
const PANE = "strakes-drawing";

/**
 * Dibuja el láser y el lápiz de un mapa. La usan el editor (MapView) y la pantalla de jugadores
 * (PlayerMap) con los mismos datos, que viven en el plugin (en memoria, nunca en el archivo).
 * Los trazos del láser se desvanecen con un bucle de animación de la ventana del mapa, que se
 * detiene en cuanto no queda ninguno desvaneciéndose.
 */
export class DrawingLayer {
	private pen = L.layerGroup();
	private laser = L.layerGroup();
	private laserState: LaserState | null = null;
	private frame = 0;

	constructor(
		private map: L.Map,
		/** Tiempo que tarda en desvanecerse un trazo del láser (ajuste), en milisegundos. */
		private fadeMs: () => number,
		/** Grosor actual (ajuste): diámetro del punto del láser. */
		private width: () => number,
	) {
		if (!map.getPane(PANE)) map.createPane(PANE).addClass("strakes-drawing-pane");
		this.pen.addTo(map);
		this.laser.addTo(map);
	}

	setPen(strokes: Stroke[]): void {
		this.pen.clearLayers();
		for (const s of strokes) this.pen.addLayer(strokeLine(s, 1));
	}

	setLaser(state: LaserState | null): void {
		this.laserState = state;
		this.drawLaser();
	}

	remove(): void {
		if (this.frame) this.map.getContainer().win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.pen.remove();
		this.laser.remove();
	}

	private drawLaser(): void {
		this.laser.clearLayers();
		const st = this.laserState;
		if (!st) return;
		const now = Date.now();
		const fade = Math.max(1, this.fadeMs());
		let fading = false;
		for (const s of st.strokes) {
			let opacity = 1;
			if (s.releasedAt !== undefined) {
				opacity = 1 - (now - s.releasedAt) / fade;
				if (opacity <= 0) continue;
				fading = true;
			}
			this.laser.addLayer(strokeLine(s, opacity));
		}
		if (st.pointer)
			this.laser.addLayer(
				// Del mismo grosor que el trazo que se dibujaría.
				L.circleMarker(toLatLng(st.pointer), {
					pane: PANE,
					radius: Math.max(1, this.width()) / 2,
					stroke: false,
					fillColor: st.color,
					fillOpacity: 1,
					interactive: false,
					className: "strakes-laser-dot",
				}),
			);
		if (fading && !this.frame)
			this.frame = this.map.getContainer().win.requestAnimationFrame(() => {
				this.frame = 0;
				this.drawLaser();
			});
	}
}

function strokeLine(s: Stroke, opacity: number): L.Polyline {
	return L.polyline(
		s.points.map((p) => toLatLng(p)),
		{ pane: PANE, color: s.color, weight: s.width, opacity, interactive: false, lineCap: "round", lineJoin: "round" },
	);
}
