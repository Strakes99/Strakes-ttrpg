import * as L from "leaflet";
import { getIconIds, setIcon } from "obsidian";
import { Pt } from "./geometry";
import { DEFAULT_PIN_COLOR, MapData, MapPin, MapRoute, MapZone, PortalLink, portalColor, RouteNode, routePath, segmentPath } from "./mapData";
import { polygonCentroid } from "./zones";
import { pointAtFraction } from "./geometry";
import { customIconName, getIconLibrary } from "./icons";

// Piezas de dibujo compartidas por el editor de mapas (MapView) y el mapa incrustado (MapEmbed).

export const toLatLng = (p: Pt): L.LatLng => L.latLng(p.y, p.x);

export function mapBounds(data: MapData): L.LatLngBounds {
	return L.latLngBounds([0, 0], [data.height, data.width]);
}

/** Icono del pin: gota de color con un emoji, texto o icono de Lucide. */
export function pinIcon(pin: MapPin): L.DivIcon {
	const el = createDiv({ cls: pin.portal ? "strakes-pin is-portal" : "strakes-pin" });
	el.setCssProps({ "--pin-color": pin.color || DEFAULT_PIN_COLOR });
	const iconEl = el.createDiv("strakes-pin-icon");
	renderPinIconInto(iconEl, pin.icon ?? "", pin.iconColor, defaultPinIcon(pin));
	// El punto del marcador es la punta de la gota, en (16, 36); el de un portal / escalera, el centro
	// de su círculo, en (16, 16). Ver la geometría en styles.css (.strakes-pin).
	return L.divIcon({ className: "strakes-pin-wrap", html: el, iconSize: [32, 40], iconAnchor: pin.portal ? [16, 16] : [16, 36] });
}

type PinIconKind = "custom" | "lucide" | "emoji" | "text" | "default";

/** Qué clase de icono es el valor del campo «Icono» de un pin. */
function pinIconKind(icon: string): PinIconKind {
	if (!icon) return "default";
	if (customIconName(icon) !== null) return "custom";
	const ids = getIconIds();
	if (/^[a-z0-9-]+$/.test(icon) && icon.length > 2 && (ids.includes(icon) || ids.includes(`lucide-${icon}`))) return "lucide";
	if (/\p{Extended_Pictographic}/u.test(icon)) return "emoji";
	return "text";
}

/** ¿Se le puede cambiar el color? (los emojis son dibujos a color del sistema: no) */
export function iconSupportsColor(icon: string): boolean {
	return pinIconKind(icon) !== "emoji";
}

/**
 * Pinta el icono de un pin en `el`: SVG personalizado, Lucide, emoji/texto o el icono
 * por defecto. `color` recolorea Lucide, texto y SVG (los emojis no se pueden).
 */
export function renderPinIconInto(el: HTMLElement, icon: string, color: string | undefined, fallbackIcon: string): void {
	const kind = pinIconKind(icon);
	if (color && kind !== "emoji") el.setCssStyles({ color });
	if (kind === "custom") {
		// SVG personalizado; si se borró de la carpeta, se usa el icono por defecto.
		if (!getIconLibrary()?.render(el, customIconName(icon)!, color)) setIcon(el, fallbackIcon);
	} else if (kind === "lucide") setIcon(el, icon);
	else if (kind === "default") setIcon(el, fallbackIcon);
	else el.setText(icon);
}

function defaultPinIcon(pin: MapPin): string {
	return pin.portal ? "orbit" : pin.link ? "scroll-text" : "map-pin";
}

export function pinTooltipText(pin: MapPin): string {
	return pin.name;
}

/**
 * Etiqueta del marcador, justo encima de su figura (la gota o el círculo del portal; ver pinIcon).
 * Al pasar el cursor, el globo del tema (strakes-map-tooltip); fija (etiquetas encendidas), la
 * pastilla oscura de las etiquetas de rutas y zonas (strakes-map-label).
 */
export function pinTooltipOptions(pin: MapPin, permanent = false): L.TooltipOptions {
	return { direction: "top", offset: [0, pin.portal ? -14 : -34], permanent, className: permanent ? "strakes-map-label" : "strakes-map-tooltip" };
}

/**
 * Etiqueta del tramo i, a mitad de su recorrido: número de tramo y nombre de la ruta
 * («1 · Camino del norte»). Con `raised`, se dibuja algo por encima de la línea
 * (para no tapar los puntos de curva). Devuelve null si el tramo no existe.
 */
export function segmentLabel(
	route: MapRoute,
	i: number,
	nodes: Map<string, RouteNode>,
	raised = false,
): L.Marker | null {
	const path = segmentPath(route, i, nodes);
	if (!path) return null;
	// Elementos del DOM (no HTML en texto): el nombre lo escribe el usuario.
	const label = createSpan();
	label.createEl("b", { text: String(i + 1) });
	if (route.name.trim()) label.appendText(` · ${route.name}`);
	return L.marker(toLatLng(pointAtFraction(path, 0.5)), {
		icon: L.divIcon({
			className: `strakes-seg-label${raised ? " is-raised" : ""}`,
			html: label,
			iconSize: null as unknown as L.PointExpression,
		}),
		keyboard: false,
		interactive: true,
	});
}

/**
 * Nombre de la ruta, una vez, en el centro de su línea. Es la etiqueta de ruta de la pantalla de
 * jugadores: sin números de tramo ni distancias (decisión del desarrollador).
 */
export function routeNameLabel(route: MapRoute, nodes: Map<string, RouteNode>): L.Marker | null {
	const path = routePath(route, nodes);
	if (path.length < 2 || !route.name.trim()) return null;
	return L.marker(toLatLng(pointAtFraction(path, 0.5)), {
		icon: L.divIcon({
			className: "strakes-seg-label",
			html: createSpan({ text: route.name }),
			iconSize: null as unknown as L.PointExpression,
		}),
		keyboard: false,
		interactive: false,
	});
}

/** Panel de Leaflet de las zonas: por debajo de rutas y marcadores (el de las rutas es el 400). */
export const ZONE_PANE = "strakes-zones";

/** Crea en el mapa el panel de las zonas, si no existe. */
export function ensureZonePane(map: L.Map): void {
	if (!map.getPane(ZONE_PANE)) map.createPane(ZONE_PANE).addClass("strakes-zones-pane");
	// Líneas de las flechas de los portales (1.3.3): por encima de la niebla (500), por debajo de los marcadores (600).
	if (!map.getPane(PORTAL_ARROW_PANE)) map.createPane(PORTAL_ARROW_PANE).addClass("strakes-portal-arrows-pane");
}

/** Panel de las líneas de las flechas de los portales (lo crea `ensureZonePane`, junto al de las zonas). */
const PORTAL_ARROW_PANE = "strakes-portal-arrows";

/**
 * Estilo del polígono de una zona: borde de 2 px y relleno con la transparencia general
 * (ajuste «Transparencia del relleno de las zonas», en %).
 */
export function zoneStyle(zone: MapZone, fillTransparency: number): L.PolylineOptions {
	const fillOpacity = Math.min(1, Math.max(0, 1 - fillTransparency / 100));
	return { pane: ZONE_PANE, color: zone.borderColor, weight: 2, opacity: 1, fillColor: zone.color, fillOpacity };
}

/** Nombre de la zona en su centro (etiquetas de zona). Sin nombre, nada. */
export function zoneNameLabel(zone: MapZone): L.Marker | null {
	if (!zone.name.trim()) return null;
	return L.marker(toLatLng(polygonCentroid(zone.points)), {
		icon: L.divIcon({
			className: "strakes-seg-label strakes-zone-label",
			html: createSpan({ text: zone.name }),
			iconSize: null as unknown as L.PointExpression,
		}),
		keyboard: false,
		interactive: false,
	});
}

/** Nodo de ruta (círculo blanco con borde del color de la ruta). */
export function nodeMarker(n: RouteNode, color: string, opts: { draggable: boolean; selected?: boolean; interactive?: boolean }): L.Marker {
	const marker = L.marker(toLatLng(n), {
		icon: L.divIcon({
			className: `strakes-node${opts.selected ? " is-selected" : ""}`,
			html: "",
			iconSize: [12, 12],
			iconAnchor: [6, 6],
		}),
		draggable: opts.draggable,
		keyboard: false,
		interactive: opts.interactive ?? true,
	});
	marker.on("add", () => marker.getElement()?.setCssProps({ "--route-color": color }));
	return marker;
}

/**
 * Flechas de los portales (1.3.3): una línea discontinua del portal a su destino y una punta en el
 * destino (en ida y vuelta, también en el portal). La línea va en su propio panel, por encima de la
 * niebla (en la vista del DM no se ve apagada) y por debajo de los marcadores; la punta es un triángulo
 * girado en el panel de los marcadores, por encima de ellos, con el mismo tamaño en pantalla a cualquier
 * zoom. Necesitan `ensureZonePane` en el mapa. Sin ratón.
 */
export function portalArrowLayers(links: readonly PortalLink[]): L.Layer[] {
	const layers: L.Layer[] = [];
	for (const link of links) {
		const color = portalColor(link.colorKey);
		layers.push(L.polyline([toLatLng(link.from), toLatLng(link.to)], { color, weight: 3, opacity: 0.95, dashArray: "8 6", interactive: false, pane: PORTAL_ARROW_PANE }));
		layers.push(arrowHead(link.to, link.from, color));
		if (link.both) layers.push(arrowHead(link.from, link.to, color));
	}
	return layers;
}

/** Punta de flecha en `at`, apuntando en la dirección que va de `from` a `at`. */
function arrowHead(at: Pt, from: Pt, color: string): L.Marker {
	// En pantalla, la y del mapa crece hacia arriba; el triángulo apunta hacia arriba sin girar.
	const angle = (Math.atan2(-(at.y - from.y), at.x - from.x) * 180) / Math.PI + 90;
	const head = createDiv({ cls: "strakes-portal-arrow-head" });
	head.setCssProps({ "--strakes-arrow-color": color, "--strakes-arrow-angle": `${angle}deg` });
	return L.marker(toLatLng(at), {
		// La punta del triángulo (arriba en el centro) cae justo en el punto.
		icon: L.divIcon({ className: "strakes-portal-arrow", html: head, iconSize: [16, 16], iconAnchor: [8, 0] }),
		interactive: false,
		keyboard: false,
		zIndexOffset: 1000,
	});
}
