import { distToSegment, Pt } from "./geometry";

// Niebla de guerra (1.3): datos y cálculo, sin Leaflet (los usan los tests). La capa que la dibuja
// está en fogLayer.ts. Se guarda en el .smap como una lista de trazos de pincel, en orden: el
// mapa empieza cubierto, «descubrir» abre un hueco y «cubrir» lo vuelve a tapar.

/** Trazo del pincel de niebla. `width`: grosor en píxeles de la imagen (escala con el zoom). */
export interface FogStroke {
	mode: "reveal" | "cover";
	width: number;
	points: Pt[];
}

/** Niebla de un mapa: activada en sus propiedades, con su color y los trazos del pincel. */
export interface MapFog {
	enabled: boolean;
	color: string;
	strokes: FogStroke[];
}

export const DEFAULT_FOG_COLOR = "#000000";

/** Valida la niebla de un .smap (escrito a mano o antiguo). Sin niebla: undefined. */
export function normalizeFog(raw: unknown): MapFog | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Partial<MapFog>;
	const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
	const strokes = (Array.isArray(r.strokes) ? r.strokes : [])
		.filter((s) => s && (s.mode === "reveal" || s.mode === "cover") && num(s.width) && s.width > 0 && Array.isArray(s.points))
		.map((s) => ({ mode: s.mode, width: s.width, points: s.points.filter((p) => p && num(p.x) && num(p.y)).map((p) => ({ x: p.x, y: p.y })) }))
		.filter((s) => s.points.length > 0);
	return { enabled: r.enabled === true, color: typeof r.color === "string" && r.color ? r.color : DEFAULT_FOG_COLOR, strokes };
}

/** ¿El trazo pasa por el punto? (a menos de la mitad de su grosor de su línea) */
function strokeTouches(s: FogStroke, p: Pt): boolean {
	const r = s.width / 2;
	if (s.points.length === 1) return Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= r;
	for (let i = 0; i < s.points.length - 1; i++) if (distToSegment(p, s.points[i], s.points[i + 1]) <= r) return true;
	return false;
}

/**
 * ¿El punto está bajo la niebla? Sin niebla activada, nunca. Si no, empieza cubierto y cada trazo
 * que pasa por él, en orden, lo descubre o lo vuelve a cubrir.
 */
export function fogCovers(fog: MapFog | undefined, p: Pt): boolean {
	if (!fog?.enabled) return false;
	let covered = true;
	for (const s of fog.strokes) if (strokeTouches(s, p)) covered = s.mode === "cover";
	return covered;
}
