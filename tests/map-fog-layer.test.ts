// Capa de niebla con Leaflet real (en jsdom): la niebla puesta antes de que el mapa tenga vista
// debe quedar con su máscara (si no, la pantalla de jugadores se veía toda negra).
import { t } from "./helpers";

// Leaflet lee window, document y navigator al cargarse: los aporta jsdom antes de requerirlo.
type JsdomModule = { JSDOM: new (html: string, opts?: { pretendToBeVisual?: boolean }) => { window: Window & typeof globalThis } };
const { JSDOM } = require("jsdom") as JsdomModule;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "Node"] as const)
	Object.defineProperty(globalThis, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
// Extensión de Obsidian que usa la capa (createPane(...).addClass).
(dom.window.Element.prototype as unknown as { addClass: (...c: string[]) => void }).addClass = function (this: Element, ...c: string[]) {
	this.classList.add(...c);
};
// Leaflet decide si hay SVG con createSVGRect, que jsdom no tiene.
(dom.window.SVGSVGElement.prototype as unknown as { createSVGRect: () => object }).createSVGRect = () => ({});
g.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
g.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
// require (no import) para cargarlos después de preparar el DOM.
const L = require("leaflet") as typeof import("leaflet");
const { FogLayer } = require("../src/map/fogLayer") as typeof import("../src/map/fogLayer");

function newMap(): L.Map {
	const el = dom.window.document.createElement("div");
	dom.window.document.body.appendChild(el);
	return L.map(el, { crs: L.CRS.Simple, zoomControl: false, attributionControl: false });
}

const bounds = L.latLngBounds([0, 0], [100, 100]);
const fog = { enabled: true, color: "#000000", strokes: [{ mode: "reveal" as const, width: 10, points: [{ x: 50, y: 50 }] }] };
const masked = (map: L.Map) => {
	const svg = map.getPane("strakes-fog")?.querySelector("svg");
	const cover = svg?.querySelector("path[mask]");
	return { mask: !!svg?.querySelector("mask"), coverMasked: !!cover, strokesInMask: svg?.querySelectorAll("mask path").length ?? 0 };
};

{
	const map = newMap();
	const layer = new FogLayer(map, 1);
	layer.set(fog, bounds);
	t("niebla antes de tener vista: aún no se dibuja", masked(map), { mask: false, coverMasked: false, strokesInMask: 0 });
	map.fitBounds(bounds, { animate: false });
	// Base blanca + el trazo que descubre.
	t("niebla antes de tener vista: al tenerla, con su máscara", masked(map), { mask: true, coverMasked: true, strokesInMask: 2 });
	layer.remove();
	map.remove();
}

{
	const map = newMap();
	const layer = new FogLayer(map, 1);
	layer.set(fog, bounds);
	layer.set({ ...fog, strokes: [] }, bounds);
	map.fitBounds(bounds, { animate: false });
	t("dos veces antes de tener vista: se dibuja una vez, la última", masked(map), { mask: true, coverMasked: true, strokesInMask: 1 });
	t("dos veces antes de tener vista: un solo rectángulo de niebla", map.getPane("strakes-fog")?.querySelectorAll("path[mask]").length, 1);
	layer.remove();
	map.remove();
}

{
	const map = newMap();
	const layer = new FogLayer(map, 1);
	layer.set(fog, bounds);
	layer.remove();
	map.fitBounds(bounds, { animate: false });
	t("quitada antes de tener vista: no se dibuja", masked(map).mask, false);
	map.remove();
}

{
	const map = newMap();
	map.fitBounds(bounds, { animate: false });
	const layer = new FogLayer(map, 1);
	layer.set(fog, bounds);
	t("con vista: se dibuja al momento", masked(map), { mask: true, coverMasked: true, strokesInMask: 2 });
	layer.remove();
	map.remove();
}

{
	// Zonas marcadas: borde blanco de 2 px que las ensancha (sin línea descubierta entre zonas contiguas).
	const map = newMap();
	map.fitBounds(bounds, { animate: false });
	const layer = new FogLayer(map, 1);
	const square = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }];
	const polyFog = { enabled: true, color: "#000000", strokes: [{ mode: "reveal" as const, width: 0, points: square, polygon: true as const }] };
	layer.set(polyFog, bounds, [{ points: square, fog: true }, { points: square }]);
	const paths = [...(map.getPane("strakes-fog")?.querySelectorAll("mask path") ?? [])];
	const attrs = (el: Element) => ({ fill: el.getAttribute("fill"), stroke: el.getAttribute("stroke"), width: el.getAttribute("stroke-width") });
	// En la máscara: base, trazo-polígono y la zona marcada (la desmarcada no entra).
	t("borde de zonas: elementos de la máscara", paths.length, 3);
	t("borde de zonas: la zona marcada lleva borde blanco de 2 px", attrs(paths[2]), { fill: "#ffffff", stroke: "#ffffff", width: "2" });
	t("borde de zonas: el trazo-polígono no lleva borde", attrs(paths[1]), { fill: "#000000", stroke: "none", width: null });
	layer.remove();
	map.remove();
}

// ---- La niebla abarca siempre la imagen entera (no solo la vista más un margen) ----

/** Mapa con tamaño (jsdom no maqueta: clientWidth/Height a mano). */
function sizedMap(): L.Map {
	const el = dom.window.document.createElement("div");
	Object.defineProperty(el, "clientWidth", { value: 800 });
	Object.defineProperty(el, "clientHeight", { value: 600 });
	dom.window.document.body.appendChild(el);
	return L.map(el, { crs: L.CRS.Simple, zoomControl: false, attributionControl: false, minZoom: -8, maxZoom: 6 });
}
type Internals = { _bounds: L.Bounds; _container: HTMLElement & { _leaflet_pos?: L.Point }; _updateTransform(c: L.LatLng, z: number): void };
const internals = (layer: unknown) => (layer as { renderer: Internals }).renderer;
const imageBounds = L.latLngBounds([0, 0], [1000, 2000]);
const covers = (map: L.Map, r: Internals) => {
	const nw = map.latLngToLayerPoint(imageBounds.getNorthWest());
	const se = map.latLngToLayerPoint(imageBounds.getSouthEast());
	return r._bounds.contains(nw) && r._bounds.contains(se);
};

{
	const map = sizedMap();
	map.setView([100, 100], 3);
	const layer = new FogLayer(map, 1);
	layer.set({ enabled: true, color: "#000000", strokes: [] }, imageBounds);
	const r = internals(layer);
	t("mapa entero: con zoom cerca de una esquina, el SVG abarca toda la imagen", covers(map, r), true);
	const rect = map.getPane("strakes-fog")?.querySelector("path[mask]")?.getAttribute("d") ?? "";
	// Sin recortar a la vista: el rectángulo llega a la esquina opuesta de la imagen.
	const se = map.latLngToLayerPoint(imageBounds.getSouthEast()).round();
	t("mapa entero: el rectángulo de niebla no se recorta a la vista", rect.includes(`${se.x} `) || rect.includes(`${se.x},`), true);
	map.setView([900, 1900], 4, { animate: false });
	t("mapa entero: tras moverse y acercarse, sigue abarcando toda la imagen", covers(map, r), true);
	layer.remove();
	map.remove();
}

{
	// Durante un zoom (flyTo), el SVG se escala sin redibujar: su esquina debe caer en el mismo punto
	// del mapa que antes. Se compara con el cálculo original de Leaflet (solo la vista).
	const map = sizedMap();
	map.setView([500, 1000], 0);
	const layer = new FogLayer(map, 1);
	layer.set({ enabled: true, color: "#000000", strokes: [] }, imageBounds);
	const r = internals(layer);
	const corner = map.layerPointToLatLng(r._bounds.min!);
	const center = L.latLng(300, 700);
	r._updateTransform(center, -2);
	const got = r._container._leaflet_pos!;
	const origin = (map as unknown as { _getNewPixelOrigin(c: L.LatLng, z: number): L.Point })._getNewPixelOrigin(center, -2);
	const want = map.project(corner, -2).subtract(origin);
	t("zoom animado: la esquina del SVG sigue en su punto del mapa", Math.abs(got.x - want.x) < 1 && Math.abs(got.y - want.y) < 1, true);
	// Sin la imagen (solo la vista), igual que Leaflet.
	(r as unknown as { _mapBounds: null; _update(): void })._mapBounds = null;
	(r as unknown as { _update(): void })._update();
	r._updateTransform(center, -2);
	const ours = r._container._leaflet_pos!;
	(L.Renderer.prototype as unknown as { _updateTransform(this: Internals, c: L.LatLng, z: number): void })._updateTransform.call(r, center, -2);
	const leaflet = r._container._leaflet_pos!;
	t("zoom animado sin imagen: igual que el cálculo de Leaflet", Math.abs(ours.x - leaflet.x) < 1 && Math.abs(ours.y - leaflet.y) < 1, true);
	layer.remove();
	map.remove();
}

// ---- Mayús pulsada antes de hacer clic también empieza un arrastre (leafletPatch, 1.3.2) ----
{
	const dragging = () => (L.Draggable as unknown as { _dragging?: unknown })._dragging;
	const down = (d: L.Draggable, shiftKey: boolean) =>
		(d as unknown as { _onDown(e: object): void })._onDown({ type: "mousedown", which: 1, button: 0, clientX: 10, clientY: 10, shiftKey });
	const el = dom.window.document.createElement("div");
	dom.window.document.body.appendChild(el);
	const before = new L.Draggable(el);
	before.enable();
	down(before, true);
	t("sin el arreglo, Leaflet no arrastra con Mayús", dragging(), undefined);
	before.disable();
	require("../src/map/leafletPatch");
	const after = new L.Draggable(el);
	after.enable();
	down(after, true);
	t("con el arreglo, Mayús+clic empieza el arrastre", dragging() === after, true);
	after.finishDrag();
	(L.Draggable as unknown as { _dragging?: unknown })._dragging = undefined;
}
