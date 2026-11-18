import { numberLocale, T } from "../i18n";
import { uid } from "../types";
import { nearestOnPolyline, polylineLength, Pt, smoothPath } from "./geometry";
import { MapFog, normalizeFog } from "./fogData";

// Coordenadas en píxeles de la imagen original: x hacia la derecha, y hacia arriba
// (lo que espera Leaflet con CRS.Simple; la imagen ocupa [0..height] × [0..width]).

/**
 * Visibilidad en el mapa. Hay dos vistas independientes, la del DM y la de los jugadores:
 *  - Dos interruptores fijos por tipo: Pines (showPins / playerPins) y Rutas (showRoutes / playerRoutes).
 *  - Capas creadas por el usuario; cada pin o ruta está en una capa o en ninguna (layerId null).
 *  - Cada pin o ruta: `hidden` (oculto en la vista del DM) y `players` (visible para jugadores).
 *  DM: un elemento se ve si no está oculto, su tipo está activo y (no tiene capa o su capa está visible).
 *  Jugadores: solo si el elemento, su tipo y su capa (si tiene) están marcados para jugadores.
 *  Lo que no tiene el campo de jugadores cuenta como oculto a los jugadores.
 */
export interface MapLayer {
	id: string;
	name: string;
	/** Visible en la vista del DM. */
	visible: boolean;
	/** Visible para los jugadores. Sin definir = oculta a los jugadores. */
	players?: boolean;
}

export type ItemType = "pins" | "routes" | "zones";

/** Interruptor del tipo en la vista del DM (ojo de la cabecera de su sección del panel). */
function typeShown(data: MapData, type: ItemType): boolean {
	return type === "pins" ? data.showPins : type === "routes" ? data.showRoutes : data.showZones;
}

/** Interruptor del tipo para los jugadores (pantalla de la cabecera de su sección del panel). */
function typeForPlayers(data: MapData, type: ItemType): boolean {
	return type === "pins" ? data.playerPins : type === "routes" ? data.playerRoutes : data.playerZones;
}

export function isItemVisible(
	data: MapData,
	type: ItemType,
	layerId: string | null,
	overrides?: { types?: Partial<Record<ItemType, boolean>>; layers?: Map<string, boolean> },
): boolean {
	const typeOn = overrides?.types?.[type] ?? typeShown(data, type);
	if (!typeOn) return false;
	if (!layerId) return true;
	return overrides?.layers?.get(layerId) ?? data.layers.find((l) => l.id === layerId)?.visible ?? true;
}

/** ¿Lo ven los jugadores? Tienen que estar marcados el elemento, su tipo y su capa (si tiene). */
export function isPlayerVisible(data: MapData, type: ItemType, item: { layerId: string | null; players?: boolean }): boolean {
	if (item.players !== true) return false;
	if (!typeForPlayers(data, type)) return false;
	if (!item.layerId) return true;
	return data.layers.find((l) => l.id === item.layerId)?.players === true;
}

export interface MapPin {
	id: string;
	name: string;
	x: number;
	y: number;
	/** Capa del usuario, o null = sin capa. */
	layerId: string | null;
	/** Wikilink a la nota (opcional): "[[Nota]]" o "[[Nota#Encabezado]]". Se abre con clic principal. */
	link?: string;
	/** Portal / escalera: con clic derecho lleva la cámara a su destino. */
	portal: boolean;
	/** Destino del portal: un punto fijo… */
	target?: { x: number; y: number; zoom: number };
	/** …o la posición de otro pin. */
	targetPinId?: string;
	color: string;
	icon: string;
	/** Color del icono. Sin definir = colores originales (SVG) o blanco (Lucide, letras). */
	iconColor?: string;
	/**
	 * Casilla AUTO: el nombre sale de la nota enlazada (alias, encabezado o nota) o, en un
	 * portal sin nota, del marcador destino. Ver map/autoName.ts. Sin definir = nombre a mano.
	 */
	autoName?: boolean;
	/** Oculto en la vista del DM (ojo del panel). Sin definir = visible. */
	hidden?: boolean;
	/** Visible para los jugadores. Sin definir = oculto a los jugadores. */
	players?: boolean;
	/**
	 * Nodo de ruta al que está anclado: el marcador está en su posición, se mueven juntos y al
	 * medir cuenta como el nodo. Sin definir = suelto. Si el nodo deja de existir, se quita.
	 */
	nodeId?: string;
}

export interface RouteNode {
	id: string;
	x: number;
	y: number;
}

export interface MapRoute {
	id: string;
	name: string;
	/** Capa del usuario, o null = sin capa. */
	layerId: string | null;
	/** Wikilink a una nota (opcional, 1.3), como en los marcadores y las zonas. */
	link?: string;
	/** Casilla AUTO: el nombre sale de la nota enlazada. Sin definir = a mano (las rutas nuevas, «Ruta N»). */
	autoName?: boolean;
	color: string;
	nodeIds: string[];
	/** Distancia manual de cada tramo (segments[i] une nodeIds[i] y nodeIds[i+1]). null = sin definir. */
	segments: (number | null)[];
	/** Tiempo de viaje manual de cada tramo, en horas a paso normal. null = calcularlo desde la distancia. */
	times?: (number | null)[];
	/**
	 * Puntos de curva de cada tramo (bends[i] va de nodeIds[i] a nodeIds[i+1]).
	 * Dan forma a la línea pero no son nodos: no se pueden conectar ni medir desde ellos.
	 */
	bends?: Pt[][];
	/** Si es true, la línea pasa por los puntos de curva con una curva suave. */
	smooth?: boolean;
	/** Oculta en la vista del DM (ojo del panel). Sin definir = visible. */
	hidden?: boolean;
	/** Visible para los jugadores. Sin definir = oculta a los jugadores. */
	players?: boolean;
}

/** Zona (1.3): polígono de lados rectos con nota, colores, área, capa y visibilidad. */
export interface MapZone {
	id: string;
	name: string;
	/** Vértices en orden (al menos 3), en píxeles de la imagen. */
	points: Pt[];
	/** Capa del usuario, o null = sin capa. */
	layerId: string | null;
	/** Wikilink a una nota (opcional), como en los marcadores. */
	link?: string;
	/** Casilla AUTO: el nombre sale de la nota enlazada (alias, encabezado o nota). Sin definir = a mano. */
	autoName?: boolean;
	/** Color del relleno (su transparencia es un ajuste general: zoneFillTransparency). */
	color: string;
	/** Color del borde (solo el color: ni grosor ni patrón). */
	borderColor: string;
	/** Área escrita a mano, en unidades² del mapa. Sin definir = calculada con la escala. */
	area?: number;
	/** Oculta en la vista del DM (ojo del panel). Sin definir = visible. */
	hidden?: boolean;
	/** Visible para los jugadores. Sin definir = oculta a los jugadores. */
	players?: boolean;
}

/** Color de relleno y borde de las zonas nuevas. */
export const DEFAULT_ZONE_COLOR = "#4dabf7";

export interface MapData {
	version: 1;
	image: string;
	width: number;
	height: number;
	unit: string;
	/** Unidades por píxel. null = mapa sin escala (solo distancias manuales). */
	scale: number | null;
	/** Interruptores por tipo, independientes de las capas (vista del DM). */
	showPins: boolean;
	showRoutes: boolean;
	/** Interruptor del tipo Zonas (vista del DM) y para los jugadores (1.3). */
	showZones: boolean;
	/** Interruptores por tipo para los jugadores. */
	playerPins: boolean;
	playerRoutes: boolean;
	playerZones: boolean;
	layers: MapLayer[];
	pins: MapPin[];
	nodes: RouteNode[];
	routes: MapRoute[];
	zones: MapZone[];
	/** Niebla de guerra (1.3). Sin definir = el mapa nunca la ha tenido. Ver fogData.ts. */
	fog?: MapFog;
}

/** Color de fondo por defecto de los pines nuevos. */
export const DEFAULT_PIN_COLOR = "#ffffff";
/** Color de icono de los pines nuevos (SVG, letras y Lucide). */
export const DEFAULT_ICON_COLOR = "#000000";
export const ROUTE_COLORS = ["#f59f00", "#e64980", "#20c997", "#4dabf7", "#a9e34b", "#ff922b"];

export function emptyMap(image: string, width: number, height: number, unit: string): MapData {
	return {
		version: 1,
		image,
		width,
		height,
		unit,
		scale: null,
		showPins: true,
		showRoutes: true,
		showZones: true,
		playerPins: false,
		playerRoutes: false,
		playerZones: false,
		layers: [],
		pins: [],
		nodes: [],
		routes: [],
		zones: [],
	};
}

/**
 * Valida el JSON del mapa y rellena los valores ausentes (p. ej. si se editó a mano).
 * `defaultUnit` se usa solo si el archivo no indica unidad.
 */
export function normalizeMap(raw: unknown, defaultUnit = "km"): MapData {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<MapData>;
	const data: MapData = {
		version: 1,
		image: typeof r.image === "string" ? r.image : "",
		width: Number(r.width) || 0,
		height: Number(r.height) || 0,
		unit: typeof r.unit === "string" ? r.unit : defaultUnit,
		scale: typeof r.scale === "number" && r.scale > 0 ? r.scale : null,
		showPins: r.showPins !== false,
		showRoutes: r.showRoutes !== false,
		showZones: r.showZones !== false,
		playerPins: r.playerPins === true,
		playerRoutes: r.playerRoutes === true,
		playerZones: r.playerZones === true,
		layers: Array.isArray(r.layers) ? r.layers : [],
		pins: Array.isArray(r.pins) ? r.pins : [],
		nodes: Array.isArray(r.nodes) ? r.nodes : [],
		routes: Array.isArray(r.routes) ? r.routes : [],
		zones: Array.isArray(r.zones) ? r.zones : [],
		fog: normalizeFog(r.fog),
	};
	for (const l of data.layers) l.players = l.players === true ? true : undefined;
	// Una capa inexistente equivale a «sin capa».
	const layerIds = new Set(data.layers.map((l) => l.id));
	const nodeIds = new Set(data.nodes.map((n) => n.id));
	for (const p of data.pins) {
		if (typeof p.name !== "string") p.name = "";
		if (!p.layerId || !layerIds.has(p.layerId)) p.layerId = null;
		if (typeof p.link !== "string" || !p.link.trim()) p.link = undefined;
		p.portal = p.portal === true;
		p.color ??= DEFAULT_PIN_COLOR;
		p.icon ??= "";
		if (typeof p.iconColor !== "string" || !p.iconColor) p.iconColor = undefined;
		p.autoName = p.autoName === true ? true : undefined;
		p.hidden = p.hidden === true ? true : undefined;
		p.players = p.players === true ? true : undefined;
		// Un ancla a un nodo que no existe se quita.
		if (typeof p.nodeId !== "string" || !nodeIds.has(p.nodeId)) p.nodeId = undefined;
	}
	for (const rt of data.routes) {
		// Un .smap escrito a mano puede no traer nombre: sin él fallarían las etiquetas.
		if (typeof rt.name !== "string") rt.name = "";
		if (!rt.layerId || !layerIds.has(rt.layerId)) rt.layerId = null;
		rt.nodeIds ??= [];
		rt.segments ??= [];
		rt.bends ??= [];
		rt.smooth ??= true;
		const n = Math.max(0, rt.nodeIds.length - 1);
		while (rt.segments.length < n) rt.segments.push(null);
		rt.segments.length = n;
		while (rt.bends.length < n) rt.bends.push([]);
		rt.bends.length = n;
		rt.bends = rt.bends.map((b) => (Array.isArray(b) ? b : []));
		rt.times = Array.isArray(rt.times) ? rt.times.map((t) => (typeof t === "number" && t > 0 ? t : null)) : [];
		while (rt.times.length < n) rt.times.push(null);
		rt.times.length = n;
		rt.color ??= ROUTE_COLORS[0];
		if (typeof rt.link !== "string" || !rt.link.trim()) rt.link = undefined;
		rt.autoName = rt.autoName === true ? true : undefined;
		rt.hidden = rt.hidden === true ? true : undefined;
		rt.players = rt.players === true ? true : undefined;
	}
	// Zonas: vértices válidos; sin al menos 3, no hay polígono y la zona se descarta.
	const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
	data.zones = data.zones.filter((z) => z && typeof z === "object" && Array.isArray(z.points));
	for (const z of data.zones) {
		z.points = z.points.filter((q) => q && num(q.x) && num(q.y)).map((q) => ({ x: q.x, y: q.y }));
		if (typeof z.name !== "string") z.name = "";
		if (!z.layerId || !layerIds.has(z.layerId)) z.layerId = null;
		if (typeof z.link !== "string" || !z.link.trim()) z.link = undefined;
		z.autoName = z.autoName === true ? true : undefined;
		if (typeof z.color !== "string" || !z.color) z.color = DEFAULT_ZONE_COLOR;
		if (typeof z.borderColor !== "string" || !z.borderColor) z.borderColor = z.color;
		z.area = num(z.area) && z.area > 0 ? z.area : undefined;
		z.hidden = z.hidden === true ? true : undefined;
		z.players = z.players === true ? true : undefined;
	}
	data.zones = data.zones.filter((z) => z.points.length >= 3);
	return data;
}

// ---------- Geometría de las rutas ----------

export function pixelDistance(a: Pt, b: Pt): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nodeMap(data: MapData): Map<string, RouteNode> {
	return new Map(data.nodes.map((n) => [n.id, n]));
}

export function bendsOf(route: MapRoute, i: number): Pt[] {
	route.bends ??= [];
	while (route.bends.length <= i) route.bends.push([]);
	return route.bends[i];
}

/** Puntos de control del tramo i: nodo inicial, puntos de curva y nodo final. */
export function segmentControlPoints(route: MapRoute, i: number, nodes: Map<string, RouteNode>): Pt[] | null {
	const a = nodes.get(route.nodeIds[i]);
	const b = nodes.get(route.nodeIds[i + 1]);
	if (!a || !b) return null;
	return [a, ...(route.bends?.[i] ?? []), b];
}

/** Línea que se dibuja para el tramo i (suavizada si la ruta lo pide). */
export function segmentPath(route: MapRoute, i: number, nodes: Map<string, RouteNode>): Pt[] | null {
	const ctrl = segmentControlPoints(route, i, nodes);
	if (!ctrl) return null;
	return route.smooth === false ? ctrl : smoothPath(ctrl);
}

/** Línea completa de la ruta. */
export function routePath(route: MapRoute, nodes: Map<string, RouteNode>): Pt[] {
	if (route.nodeIds.length === 1) {
		const n = nodes.get(route.nodeIds[0]);
		return n ? [n] : [];
	}
	const out: Pt[] = [];
	for (let i = 0; i < route.nodeIds.length - 1; i++) {
		const seg = segmentPath(route, i, nodes);
		if (!seg) continue;
		out.push(...(out.length ? seg.slice(1) : seg));
	}
	return out;
}

// ---------- Distancias ----------

export interface SegmentInfo {
	value: number | null;
	/** true si viene de la escala del mapa y no de un valor manual. */
	estimated: boolean;
}

export function segmentDistance(data: MapData, route: MapRoute, i: number, nodes = nodeMap(data)): SegmentInfo {
	const manual = route.segments[i];
	if (typeof manual === "number") return { value: manual, estimated: false };
	if (data.scale) {
		const path = segmentPath(route, i, nodes);
		if (path) return { value: polylineLength(path) * data.scale, estimated: true };
	}
	return { value: null, estimated: false };
}

export interface RouteTotal {
	total: number;
	unknown: number;
	segments: number;
}

export function routeTotal(data: MapData, route: MapRoute, nodes = nodeMap(data)): RouteTotal {
	let total = 0;
	let unknown = 0;
	const n = Math.max(0, route.nodeIds.length - 1);
	for (let i = 0; i < n; i++) {
		const d = segmentDistance(data, route, i, nodes).value;
		if (d === null) unknown++;
		else total += d;
	}
	return { total, unknown, segments: n };
}

export function formatDistance(value: number, unit: string): string {
	const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded.toLocaleString(numberLocale())} ${unit}`.trim();
}

const KM_PER_MILE = 1.609344;

/**
 * Unidad para mostrar (ajuste «Unidad de distancia»): «map» = la de cada mapa, o una de
 * `unitOptions()` («km», «mi», «leguas»…). Es también la unidad de los mapas nuevos.
 */
export type DisplayUnit = string;

/** Unidades del selector (ajustes y Propiedades del mapa). Todas las reconoce `milesPerUnit`. */
export function unitOptions(): { value: string; label: string }[] {
	return [
		{ value: "km", label: T("Kilómetros", "Kilometers") },
		{ value: "mi", label: T("Millas", "Miles") },
		{ value: T("leguas", "leagues"), label: T("Leguas", "Leagues") },
		{ value: "m", label: T("Metros", "Meters") },
		{ value: "ft", label: T("Pies", "Feet") },
	];
}

/** Unidad de los mapas nuevos: la elegida para mostrar, o kilómetros con «Las de cada mapa». */
export function newMapUnit(display: DisplayUnit): string {
	return display === "map" || milesPerUnit(display) === null ? "km" : display;
}

/**
 * Distancia guardada en la unidad del mapa, lista para mostrar en la unidad elegida.
 * Solo se convierte el texto: el valor guardado no cambia, así que alternar de unidad
 * nunca acumula redondeos. Las unidades que no son de longitud (p. ej. «días») se
 * muestran tal cual.
 */
export function displayDistance(value: number, unit: string, display: DisplayUnit): string {
	if (display !== "map") {
		const from = milesPerUnit(unit);
		const to = milesPerUnit(display);
		if (from !== null && to !== null) {
			// El mapa ya está en esa unidad: no hay conversión, se muestra como siempre.
			if (from === to) return formatDistance(value, display);
			// Convertida: con hasta 2 decimales (3,1 mi → «4,99 km»).
			const converted = (value * from) / to;
			return `${converted.toLocaleString(numberLocale(), { maximumFractionDigits: 2 })} ${display}`;
		}
	}
	return formatDistance(value, unit);
}

export function formatTotal(t: RouteTotal, unit: string, display: DisplayUnit = "map"): string {
	if (!t.segments) return "—";
	if (t.unknown === t.segments) return T("sin distancias", "no distances");
	const base = displayDistance(t.total, unit, display);
	if (!t.unknown) return base;
	const s = t.unknown > 1 ? "s" : "";
	return T(`${base} + ${t.unknown} tramo${s} sin distancia`, `${base} + ${t.unknown} segment${s} without distance`);
}

// ---------- Tiempos de viaje ----------

export type Pace = "slow" | "normal" | "fast";

/** Pasos de viaje: millas por hora y horas de marcha por día. */
export const PACES: Record<Pace, { label: string; mph: number; hoursPerDay: number }> = {
	slow: { get label() { return T("Lento", "Slow"); }, mph: 2, hoursPerDay: 9 },
	normal: { get label() { return T("Normal", "Normal"); }, mph: 3, hoursPerDay: 8 },
	fast: { get label() { return T("Rápido", "Fast"); }, mph: 4, hoursPerDay: 7.5 },
};

/**
 * Millas por unidad del mapa, deducidas del nombre de la unidad.
 * null si la unidad no es de longitud conocida (p. ej. «días»): entonces el tiempo
 * solo sale de los tiempos escritos a mano.
 */
export function milesPerUnit(unit: string): number | null {
	const u = unit.trim().toLowerCase().replace(/\.$/, "");
	if (["mi", "milla", "millas", "mile", "miles"].includes(u)) return 1;
	if (["km", "kms", "kilómetro", "kilómetros", "kilometro", "kilometros", "kilometer", "kilometers"].includes(u)) return 1 / KM_PER_MILE;
	if (["legua", "leguas", "league", "leagues"].includes(u)) return 3;
	if (["m", "metro", "metros", "meter", "meters"].includes(u)) return 1 / (KM_PER_MILE * 1000);
	if (["ft", "pie", "pies", "foot", "feet"].includes(u)) return 1 / 5280;
	return null;
}

export interface SegmentTime {
	hours: number | null;
	/** true si viene de un tiempo escrito a mano (a paso normal). */
	manual: boolean;
}

/**
 * Tiempo de viaje del tramo i al paso indicado. Prioridad: el tiempo manual (pensado a
 * paso normal) ajustado por el factor del paso; si no hay, se calcula desde la distancia.
 */
export function segmentTime(data: MapData, route: MapRoute, i: number, pace: Pace, nodes = nodeMap(data)): SegmentTime {
	const manual = route.times?.[i];
	if (typeof manual === "number") return { hours: manual * (PACES.normal.mph / PACES[pace].mph), manual: true };
	const dist = segmentDistance(data, route, i, nodes).value;
	const mpu = milesPerUnit(data.unit);
	if (dist === null || mpu === null) return { hours: null, manual: false };
	return { hours: (dist * mpu) / PACES[pace].mph, manual: false };
}

/** Tiempo al paso indicado a partir de una distancia en unidades del mapa (línea recta). */
export function distanceTime(data: MapData, distance: number, pace: Pace): number | null {
	const mpu = milesPerUnit(data.unit);
	return mpu === null ? null : (distance * mpu) / PACES[pace].mph;
}

export interface TimeTotal {
	hours: number;
	/** Tramos sin tiempo posible (ni manual ni distancia convertible). */
	unknown: number;
}

export function legsTime(data: MapData, legs: PathLeg[], pace: Pace): TimeTotal {
	const nodes = nodeMap(data);
	let hours = 0;
	let unknown = 0;
	for (const leg of legs) {
		const route = data.routes.find((r) => r.id === leg.routeId);
		const t = route ? segmentTime(data, route, leg.seg, pace, nodes).hours : null;
		if (t === null) unknown++;
		else hours += t;
	}
	return { hours, unknown };
}

export function routeTime(data: MapData, route: MapRoute, pace: Pace): TimeTotal {
	const legs = route.nodeIds.slice(1).map((_, seg) => ({ routeId: route.id, seg, reversed: false }));
	return legsTime(data, legs, pace);
}

/** «6 h 30 min», «45 min». */
export function formatHours(hours: number): string {
	const totalMin = Math.round(hours * 60);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (!h) return `${m} min`;
	return m ? `${h} h ${m} min` : `${h} h`;
}

/** Tiempo de viaje con días de marcha según el paso: «1 día y 6 h (14 h de marcha)». */
export function formatTravelTime(hours: number, pace: Pace): string {
	const perDay = PACES[pace].hoursPerDay;
	// En minutos enteros, igual que formatHours: así un resto que se redondea a una
	// jornada completa cuenta como un día más («2 días», no «1 día y 8 h»).
	const totalMin = Math.round(hours * 60);
	const perDayMin = Math.round(perDay * 60);
	const days = Math.floor(totalMin / perDayMin);
	const restMin = totalMin - days * perDayMin;
	if (!days) return formatHours(hours);
	const s = days > 1 ? "s" : "";
	const dayTxt = T(`${days} día${s}`, `${days} day${s}`);
	const restTxt = restMin > 0 ? T(` y ${formatHours(restMin / 60)}`, ` and ${formatHours(restMin / 60)}`) : "";
	const perDayTxt = perDay.toLocaleString(numberLocale());
	return T(
		`${dayTxt}${restTxt} (${formatHours(hours)} de marcha, ${perDayTxt} h/día)`,
		`${dayTxt}${restTxt} (${formatHours(hours)} of travel, ${perDayTxt} h/day)`,
	);
}

/** Interpreta «6», «6,5», «6h», «6 h 30 min», «45 min», «1h30», «2 hours 15 minutes» → horas. */
export function parseHoursInput(s: string): number | null {
	const t = s.trim().toLowerCase().replace(",", ".");
	if (!t) return null;
	if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
	const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:oras?|ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|mins?|minutos?|minutes?)?)?$/);
	if (!m || (!m[1] && !m[2])) return null;
	return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? parseInt(m[2], 10) / 60 : 0);
}

/** Un tramo recorrido dentro de un camino: qué ruta, qué tramo y en qué sentido. */
export interface PathLeg {
	routeId: string;
	seg: number;
	reversed: boolean;
}

export interface PathResult {
	nodeIds: string[];
	legs: PathLeg[];
	distance: number;
	/** Tramos del camino sin distancia conocida (contados como 0). */
	unknown: number;
}

/**
 * Camino más corto entre dos nodos usando las rutas indicadas (Dijkstra por distancia).
 * Primero intenta usar solo tramos con distancia conocida; si no hay camino,
 * repite permitiendo tramos sin distancia, priorizando el que tenga menos.
 */
export function shortestPath(data: MapData, routes: MapRoute[], from: string, to: string): PathResult | null {
	const nodes = nodeMap(data);
	const res = cheapestPath(routes, from, to, (r, i) => segmentDistance(data, r, i, nodes).value);
	return res && { nodeIds: res.nodeIds, legs: res.legs, distance: res.cost, unknown: res.unknown };
}

/**
 * Camino más rápido entre dos nodos (Dijkstra por tiempo de viaje): cada tramo cuesta su
 * `segmentTime` (el tiempo manual si lo tiene, si no el de su distancia). Como todos los tiempos
 * se escalan igual con el paso, el camino no depende del paso: solo sus horas. Los tramos sin
 * tiempo posible cuentan como los tramos sin distancia de `shortestPath`. `distance` y
 * `unknown` son los del camino (distancia conocida y tramos sin distancia), para mostrarlo igual.
 */
export function fastestPath(data: MapData, routes: MapRoute[], from: string, to: string, pace: Pace = "normal"): PathResult | null {
	const nodes = nodeMap(data);
	const res = cheapestPath(routes, from, to, (r, i) => segmentTime(data, r, i, pace, nodes).hours);
	if (!res) return null;
	return { nodeIds: res.nodeIds, legs: res.legs, ...legsDistance(data, res.legs) };
}

/** Distancia conocida de unos tramos y cuántos no tienen distancia. */
export function legsDistance(data: MapData, legs: PathLeg[]): { distance: number; unknown: number } {
	const nodes = nodeMap(data);
	let distance = 0;
	let unknown = 0;
	for (const leg of legs) {
		const route = data.routes.find((r) => r.id === leg.routeId);
		const d = route ? segmentDistance(data, route, leg.seg, nodes).value : null;
		if (d === null) unknown++;
		else distance += d;
	}
	return { distance, unknown };
}

/** ¿Recorren los dos caminos los mismos tramos? (el más corto y el más rápido coinciden) */
export function samePath(a: PathResult, b: PathResult): boolean {
	return a.legs.length === b.legs.length && a.legs.every((l, i) => l.routeId === b.legs[i].routeId && l.seg === b.legs[i].seg);
}

/**
 * Dijkstra sobre las rutas con un coste por tramo (`null` = coste desconocido). Primero solo con
 * tramos de coste conocido; si no hay camino, permite los desconocidos (cuentan 0), priorizando
 * el que tenga menos.
 */
function cheapestPath(
	routes: MapRoute[],
	from: string,
	to: string,
	segCost: (route: MapRoute, i: number) => number | null,
): { nodeIds: string[]; legs: PathLeg[]; cost: number; unknown: number } | null {
	if (from === to) return { nodeIds: [from], legs: [], cost: 0, unknown: 0 };
	type Edge = { to: string; d: number | null; leg: PathLeg };
	const adj = new Map<string, Edge[]>();
	const link = (a: string, b: string, d: number | null, leg: PathLeg) => {
		if (!adj.has(a)) adj.set(a, []);
		adj.get(a)!.push({ to: b, d, leg });
	};
	for (const r of routes) {
		for (let i = 0; i < r.nodeIds.length - 1; i++) {
			const d = segCost(r, i);
			link(r.nodeIds[i], r.nodeIds[i + 1], d, { routeId: r.id, seg: i, reversed: false });
			link(r.nodeIds[i + 1], r.nodeIds[i], d, { routeId: r.id, seg: i, reversed: true });
		}
	}
	const run = (allowUnknown: boolean): { nodeIds: string[]; legs: PathLeg[]; cost: number; unknown: number } | null => {
		const dist = new Map<string, number>([[from, 0]]);
		const unk = new Map<string, number>([[from, 0]]);
		const prev = new Map<string, { node: string; leg: PathLeg }>();
		const done = new Set<string>();
		// Coste lexicográfico: primero menos tramos desconocidos, luego menor distancia.
		const better = (u1: number, d1: number, u2: number, d2: number) => u1 < u2 || (u1 === u2 && d1 < d2);
		while (true) {
			let cur: string | null = null;
			let best = Infinity;
			let bestU = Infinity;
			for (const [id, d] of dist) {
				if (done.has(id)) continue;
				const u = unk.get(id) ?? 0;
				if (better(u, d, bestU, best)) {
					best = d;
					bestU = u;
					cur = id;
				}
			}
			if (cur === null) return null;
			if (cur === to) break;
			done.add(cur);
			for (const e of adj.get(cur) ?? []) {
				if (e.d === null && !allowUnknown) continue;
				const nd = best + (e.d ?? 0);
				const nu = bestU + (e.d === null ? 1 : 0);
				const old = dist.get(e.to);
				if (old === undefined || better(nu, nd, unk.get(e.to) ?? 0, old)) {
					dist.set(e.to, nd);
					unk.set(e.to, nu);
					prev.set(e.to, { node: cur, leg: e.leg });
				}
			}
		}
		const path = [to];
		const legs: PathLeg[] = [];
		while (path[0] !== from) {
			const p = prev.get(path[0])!;
			legs.unshift(p.leg);
			path.unshift(p.node);
		}
		return { nodeIds: path, legs, cost: dist.get(to)!, unknown: unk.get(to) ?? 0 };
	};
	return run(false) ?? run(true);
}

/** Línea dibujable de un camino calculado (respeta las curvas de cada tramo). */
export function pathGeometry(data: MapData, res: PathResult): Pt[] {
	const nodes = nodeMap(data);
	const out: Pt[] = [];
	for (const leg of res.legs) {
		const route = data.routes.find((r) => r.id === leg.routeId);
		const seg = route ? segmentPath(route, leg.seg, nodes) : null;
		if (!seg) continue;
		const pts = leg.reversed ? seg.slice().reverse() : seg;
		out.push(...(out.length ? pts.slice(1) : pts));
	}
	return out;
}

// ---------- Edición ----------

/** Elimina nodos que ya no pertenecen a ninguna ruta, y las anclas de los marcadores a esos nodos. */
export function pruneNodes(data: MapData): void {
	const used = new Set(data.routes.flatMap((r) => r.nodeIds));
	data.nodes = data.nodes.filter((n) => used.has(n.id));
	for (const p of data.pins) if (p.nodeId && !used.has(p.nodeId)) p.nodeId = undefined;
}

/**
 * Quita un nodo de todas las rutas, fusionando los tramos adyacentes.
 * El nodo eliminado se conserva como punto de curva para no perder la forma del camino.
 */
export function deleteNode(data: MapData, nodeId: string): void {
	const node = data.nodes.find((n) => n.id === nodeId);
	for (const r of data.routes) {
		r.bends ??= [];
		r.times ??= [];
		let k: number;
		while ((k = r.nodeIds.indexOf(nodeId)) >= 0) {
			if (k === 0) {
				r.nodeIds.shift();
				r.segments.shift();
				r.bends.shift();
				r.times.shift();
			} else if (k === r.nodeIds.length - 1) {
				r.nodeIds.pop();
				r.segments.pop();
				r.bends.pop();
				r.times.pop();
			} else {
				const a = r.segments[k - 1];
				const b = r.segments[k];
				r.segments.splice(k - 1, 2, a !== null && b !== null ? a + b : null);
				const ta = r.times[k - 1] ?? null;
				const tb = r.times[k] ?? null;
				r.times.splice(k - 1, 2, ta !== null && tb !== null ? ta + tb : null);
				const merged = [...(r.bends[k - 1] ?? []), ...(node ? [{ x: node.x, y: node.y }] : []), ...(r.bends[k] ?? [])];
				r.bends.splice(k - 1, 2, merged);
				r.nodeIds.splice(k, 1);
			}
		}
	}
	data.routes = data.routes.filter((r) => r.nodeIds.length >= 2);
	pruneNodes(data);
}

/**
 * Inserta un nodo nuevo en el tramo i de una ruta. Los puntos de curva se reparten
 * entre los dos tramos nuevos y la distancia manual se divide proporcionalmente.
 */
export function splitSegment(data: MapData, route: MapRoute, i: number, point: Pt): RouteNode {
	const nodes = nodeMap(data);
	const a = nodes.get(route.nodeIds[i])!;
	const b = nodes.get(route.nodeIds[i + 1])!;
	const node: RouteNode = { id: uid(), x: point.x, y: point.y };
	data.nodes.push(node);
	nodes.set(node.id, node);

	const bends = bendsOf(route, i);
	// ¿Entre qué puntos de control cae el clic? (a, ...bends, b)
	const j = nearestOnPolyline([a, ...bends, b], point).index;
	const b1 = bends.slice(0, j);
	const b2 = bends.slice(j);

	// Distancia y tiempo manuales se reparten en proporción a la longitud de cada mitad.
	const shape = (pts: Pt[]) => (route.smooth === false ? pts : smoothPath(pts));
	const d1 = polylineLength(shape([a, ...b1, node]));
	const d2 = polylineLength(shape([node, ...b2, b]));
	const ratio = d1 + d2 > 0 ? d1 / (d1 + d2) : 0.5;
	const split = (v: number | null | undefined): [number | null, number | null] =>
		typeof v === "number" ? [v * ratio, v - v * ratio] : [null, null];

	route.nodeIds.splice(i + 1, 0, node.id);
	route.segments.splice(i, 1, ...split(route.segments[i]));
	route.bends!.splice(i, 1, b1, b2);
	route.times ??= [];
	while (route.times.length < route.segments.length - 1) route.times.push(null);
	route.times.splice(i, 1, ...split(route.times[i]));
	return node;
}

/** Índice del tramo de la ruta más cercano a un punto (según la línea dibujada). */
export function nearestSegment(data: MapData, route: MapRoute, p: Pt): number {
	const nodes = nodeMap(data);
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < route.nodeIds.length - 1; i++) {
		const path = segmentPath(route, i, nodes);
		if (!path) continue;
		const d = nearestOnPolyline(path, p).dist;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/** Invierte el sentido de la ruta (nodos, distancias, tiempos y curvas). */
export function reverseRoute(route: MapRoute): void {
	route.nodeIds.reverse();
	route.segments.reverse();
	route.times = (route.times ?? []).reverse();
	route.bends = (route.bends ?? []).map((b) => b.slice().reverse()).reverse();
}

/** Interpreta "10", "10 km", "3,5 días" → { value, unit }. */
export function parseDistanceInput(s: string): { value: number; unit: string } | null {
	const m = s.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
	if (!m) return null;
	return { value: parseFloat(m[1].replace(",", ".")), unit: m[2].trim() };
}
