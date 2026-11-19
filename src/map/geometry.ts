// Utilidades geométricas: rutas curvas, polígonos (zonas y niebla) y alineado con Mayús.

export interface Pt {
	x: number;
	y: number;
}

const SAMPLES_PER_SPAN = 12;

/**
 * Punto en el tramo i→i+1 de una spline Catmull-Rom centrípeta que pasa por todos
 * los puntos de control (t ∈ [0,1]). La variante centrípeta evita bucles y
 * sobreoscilaciones cuando los puntos están desigualmente espaciados.
 */
export function curvePoint(points: Pt[], i: number, t: number): Pt {
	const p1 = points[i];
	const p2 = points[i + 1];
	// En los extremos extrapolamos un punto virtual para que la curva empiece/acabe recta.
	const p0 = points[i - 1] ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
	const p3 = points[i + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };

	const knot = (a: Pt, b: Pt) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4);
	const t0 = 0;
	const t1 = t0 + knot(p0, p1);
	const t2 = t1 + knot(p1, p2);
	const t3 = t2 + knot(p2, p3);
	const tt = t1 + (t2 - t1) * t;

	const mix = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
		const wa = (tb - tt) / (tb - ta);
		const wb = (tt - ta) / (tb - ta);
		return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb };
	};
	const a1 = mix(p0, p1, t0, t1);
	const a2 = mix(p1, p2, t1, t2);
	const a3 = mix(p2, p3, t2, t3);
	const b1 = mix(a1, a2, t0, t2);
	const b2 = mix(a2, a3, t1, t3);
	return mix(b1, b2, t1, t2);
}

/** Curva suave muestreada que pasa por todos los puntos. Con 2 puntos devuelve la recta. */
export function smoothPath(points: Pt[]): Pt[] {
	if (points.length < 3) return points.slice();
	const out: Pt[] = [points[0]];
	for (let i = 0; i < points.length - 1; i++) {
		for (let s = 1; s < SAMPLES_PER_SPAN; s++) out.push(curvePoint(points, i, s / SAMPLES_PER_SPAN));
		out.push(points[i + 1]);
	}
	return out;
}

export function polylineLength(pts: Pt[]): number {
	let len = 0;
	for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
	return len;
}

/** Punto situado a una fracción (0..1) de la longitud de la polilínea. */
export function pointAtFraction(pts: Pt[], frac: number): Pt {
	if (pts.length === 1) return pts[0];
	const target = polylineLength(pts) * frac;
	let acc = 0;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const d = Math.hypot(b.x - a.x, b.y - a.y);
		if (acc + d >= target && d > 0) {
			const t = (target - acc) / d;
			return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
		}
		acc += d;
	}
	return pts[pts.length - 1];
}

/** Distancia mínima de un punto a una polilínea y el índice del sub-tramo más cercano. */
export function nearestOnPolyline(pts: Pt[], p: Pt): { dist: number; index: number } {
	let best = { dist: Infinity, index: 0 };
	for (let i = 0; i < pts.length - 1; i++) {
		const d = distToSegment(p, pts[i], pts[i + 1]);
		if (d < best.dist) best = { dist: d, index: i };
	}
	if (pts.length === 1) best = { dist: Math.hypot(p.x - pts[0].x, p.y - pts[0].y), index: 0 };
	return best;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** ¿El punto está dentro del polígono? (regla par-impar; el borde puede contar o no). */
export function pointInPolygon(p: Pt, points: readonly Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i];
		const b = points[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

/** Las 8 direcciones de Mayús (0°, 45°, 90°…), como vectores unitarios exactos. */
const D = Math.SQRT1_2;
const DIRECTIONS: readonly Pt[] = [
	{ x: 1, y: 0 },
	{ x: D, y: D },
	{ x: 0, y: 1 },
	{ x: -D, y: D },
	{ x: -1, y: 0 },
	{ x: -D, y: -D },
	{ x: 0, y: -1 },
	{ x: D, y: -D },
];

/**
 * Mayús al arrastrar o dibujar: el punto en línea recta desde el origen, en la más cercana de las 8
 * direcciones (horizontal, vertical o diagonal), a la distancia de su proyección sobre ella.
 */
export function constrainAngle(origin: Pt, p: Pt): Pt {
	const dx = p.x - origin.x;
	const dy = p.y - origin.y;
	if (!dx && !dy) return { x: p.x, y: p.y };
	const i = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
	const u = DIRECTIONS[i];
	const d = dx * u.x + dy * u.y;
	// En horizontal y vertical, la otra coordenada queda exactamente igual que la del origen.
	return { x: u.x === 0 ? origin.x : origin.x + u.x * d, y: u.y === 0 ? origin.y : origin.y + u.y * d };
}
