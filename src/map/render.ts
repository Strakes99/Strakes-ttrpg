import * as L from "leaflet";
import { getIconIds, setIcon } from "obsidian";
import { Pt } from "./geometry";
import { MapData, MapPin, MapRoute, DEFAULT_PIN_COLOR, RouteNode, segmentPath } from "./mapData";
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
	// La punta de la gota está en (16, 36): ver la geometría en styles.css (.strakes-pin).
	return L.divIcon({ className: "strakes-pin-wrap", html: el, iconSize: [32, 40], iconAnchor: [16, 36] });
}

export type PinIconKind = "custom" | "lucide" | "emoji" | "text" | "default";

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

export const PIN_TOOLTIP_OPTIONS: L.TooltipOptions = {
	direction: "top",
	offset: [0, -34],
	className: "strakes-map-tooltip",
};

/**
 * Etiqueta del tramo i, a mitad de su recorrido: número de tramo y nombre de la ruta
 * («1 · Camino del norte»). Con `raised`, se dibuja algo por encima de la línea
 * (para no tapar los puntos de curva). Devuelve null si el tramo no existe.
 */
export function segmentLabel(
	route: MapRoute,
	i: number,
	nodes: Map<string, RouteNode>,
	interactive: boolean,
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
		interactive,
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
