import { distToSegment, pointInPolygon, Pt } from "./geometry";

// Niebla de guerra (1.3): datos y cálculo, sin Leaflet (los usan los tests). La capa que la dibuja
// está en fogLayer.ts. Se guarda en el .smap como una lista de trazos de pincel, en orden: el
// mapa empieza cubierto, «descubrir» abre un hueco y «cubrir» lo vuelve a tapar.

/**
 * Trazo del pincel de niebla. `width`: grosor en píxeles de la imagen (escala con el zoom).
 * Con `polygon`, los puntos son un polígono relleno (sin grosor): lo que deja una zona con la niebla
 * marcada al borrarla (su área sigue cubierta, ahora como niebla de pincel).
 */
export interface FogStroke {
	mode: "reveal" | "cover";
	width: number;
	points: Pt[];
	polygon?: true;
}

/** Lo que la niebla necesita de una zona: su forma y su casilla «Niebla». */
export interface FogZone {
	points: Pt[];
	/** Casilla «Niebla» marcada: la zona entera cubierta, y el pincel no la descubre. Sin definir = no cuenta. */
	fog?: boolean;
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
	const strokes: FogStroke[] = (Array.isArray(r.strokes) ? r.strokes : [])
		.filter((s) => s && (s.mode === "reveal" || s.mode === "cover") && Array.isArray(s.points) && (s.polygon === true || (num(s.width) && s.width > 0)))
		.map((s) => {
			const points = s.points.filter((p) => p && num(p.x) && num(p.y)).map((p) => ({ x: p.x, y: p.y }));
			return s.polygon === true ? { mode: s.mode, width: 0, points, polygon: true as const } : { mode: s.mode, width: s.width, points };
		})
		.filter((s) => s.points.length >= (s.polygon ? 3 : 1));
	return { enabled: r.enabled === true, color: typeof r.color === "string" && r.color ? r.color : DEFAULT_FOG_COLOR, strokes };
}

/** ¿El trazo pasa por el punto? (a menos de la mitad de su grosor de su línea; o dentro, si es un polígono) */
function strokeTouches(s: FogStroke, p: Pt): boolean {
	if (s.polygon) return pointInPolygon(p, s.points);
	const r = s.width / 2;
	if (s.points.length === 1) return Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= r;
	for (let i = 0; i < s.points.length - 1; i++) if (distToSegment(p, s.points[i], s.points[i + 1]) <= r) return true;
	return false;
}

/**
 * ¿El punto está bajo la niebla? Sin niebla activada, nunca. Dentro de una zona con la casilla
 * «Niebla» marcada, cubierto (la zona protege del pincel). Si no, manda el pincel: empieza cubierto y
 * cada trazo que pasa por él, en orden, lo descubre o lo vuelve a cubrir. Las zonas desmarcadas no cuentan.
 */
export function fogCovers(fog: MapFog | undefined, p: Pt, zones: readonly FogZone[] = []): boolean {
	if (!fog?.enabled) return false;
	if (zones.some((z) => z.fog === true && pointInPolygon(p, z.points))) return true;
	let covered = true;
	for (const s of fog.strokes) if (strokeTouches(s, p)) covered = s.mode === "cover";
	return covered;
}
