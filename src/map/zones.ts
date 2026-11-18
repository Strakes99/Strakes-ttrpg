import { numberLocale } from "../i18n";
import { Pt } from "./geometry";

// Se usa junto con el resto de la geometría de zonas: está en geometry.ts para que la niebla
// (fogData.ts) pueda usarla sin depender del modelo de datos.
export { pointInPolygon } from "./geometry";
import { DisplayUnit, MapData, MapZone, milesPerUnit } from "./mapData";

// Zonas: polígonos de lados rectos (puntos en píxeles de la imagen, como el resto del mapa).
// El tipo MapZone y sus valores por defecto están en mapData.ts.

/** Área de un polígono en píxeles² (fórmula del lazo; da igual el sentido de los vértices). */
export function polygonArea(points: readonly Pt[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

/**
 * Centro de un polígono (centroide de su área), donde va su nombre. Con un área casi nula
 * (vértices alineados), la media de los vértices.
 */
export function polygonCentroid(points: readonly Pt[]): Pt {
	let a = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		const q = points[(i + 1) % points.length];
		const f = p.x * q.y - q.x * p.y;
		a += f;
		cx += (p.x + q.x) * f;
		cy += (p.y + q.y) * f;
	}
	if (Math.abs(a) < 1e-9) {
		const n = points.length || 1;
		return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
	}
	return { x: cx / (3 * a), y: cy / (3 * a) };
}


/**
 * Área de una zona en unidades² del mapa: la escrita a mano tiene prioridad; si no, la calculada
 * con la escala; sin escala, null (igual que las distancias de las rutas).
 */
export function zoneArea(data: MapData, zone: MapZone): { value: number; estimated: boolean } | null {
	if (typeof zone.area === "number") return { value: zone.area, estimated: false };
	if (data.scale) return { value: polygonArea(zone.points) * data.scale * data.scale, estimated: true };
	return null;
}

/**
 * Área en unidades² del mapa, lista para mostrar en la unidad elegida (ajuste «Unidad de
 * distancia»), como `displayDistance` pero al cuadrado: «12,5 km²».
 */
export function displayArea(value: number, unit: string, display: DisplayUnit): string {
	let v = value;
	let u = unit;
	if (display !== "map") {
		const from = milesPerUnit(unit);
		const to = milesPerUnit(display);
		if (from !== null && to !== null && from !== to) {
			v = value * (from / to) ** 2;
			u = display;
		} else if (from !== null && to !== null) u = display;
	}
	const rounded = v >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
	return `${rounded.toLocaleString(numberLocale())} ${u}²`.trim();
}
