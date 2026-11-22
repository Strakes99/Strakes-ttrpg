// 1.3.3: flechas de los portales (qué flechas hay y su color) y coma decimal en los campos.
import { MapPin, portalColor, portalLinks } from "../src/map/mapData";
import { parseDecimal } from "../src/ui/dom";
import { t } from "./helpers";

// ---- Coma decimal ----
t("decimal: con coma", parseDecimal("1,52"), 1.52);
t("decimal: con punto", parseDecimal("1.52"), 1.52);
t("decimal: entero", parseDecimal("30"), 30);
t("decimal: con espacios", parseDecimal("  0,5 "), 0.5);
t("decimal: negativo", parseDecimal("-2,5"), -2.5);
t("decimal: sin cero delante", parseDecimal(",5"), 0.5);
t("decimal: a medio escribir («3,»)", parseDecimal("3,"), 3);
t("decimal: vacío → no es un número", Number.isNaN(parseDecimal("")), true);
t("decimal: texto → no es un número", Number.isNaN(parseDecimal("abc")), true);
t("decimal: número con texto detrás → no es un número", Number.isNaN(parseDecimal("1,5 km")), true);
t("decimal: dos separadores → no es un número", Number.isNaN(parseDecimal("1,5,2")), true);

// ---- Flechas de los portales ----
const pin = (id: string, x: number, y: number, extra: Partial<MapPin> = {}): MapPin => ({ id, name: id, x, y, layerId: null, portal: false, color: "#fff", ...extra });
const all = () => true;

{
	const pins = [pin("a", 0, 0, { portal: true, targetPinId: "b" }), pin("b", 10, 0)];
	t("flecha a otro marcador", portalLinks(pins, all), [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, both: false, colorKey: "a" }]);
}
{
	const pins = [pin("a", 0, 0, { portal: true, target: { x: 5, y: 7, zoom: 1 } })];
	t("flecha a un punto fijo", portalLinks(pins, all), [{ from: { x: 0, y: 0 }, to: { x: 5, y: 7 }, both: false, colorKey: "a" }]);
}
{
	const pins = [pin("a", 0, 0, { portal: true })];
	t("portal sin destino: sin flecha", portalLinks(pins, all), []);
}
{
	const pins = [pin("a", 0, 0, { portal: true, targetPinId: "borrado", target: { x: 5, y: 5, zoom: 1 } })];
	t("marcador destino borrado: sin flecha (como al usarlo en el editor)", portalLinks(pins, all), []);
}
{
	const pins = [pin("a", 0, 0, { targetPinId: "b" }), pin("b", 10, 0)];
	t("un marcador que no es portal: sin flecha", portalLinks(pins, all), []);
}
{
	const pins = [pin("b", 10, 0, { portal: true, targetPinId: "a" }), pin("a", 0, 0, { portal: true, targetPinId: "b" })];
	const links = portalLinks(pins, all);
	t("ida y vuelta: una sola flecha", links.length, 1);
	t("ida y vuelta: con punta en los dos extremos", links[0].both, true);
	t("ida y vuelta: el color sale del id menor (el mismo se mire por donde se mire)", links[0].colorKey, "a");
}
{
	const pins = [pin("a", 0, 0, { portal: true, targetPinId: "b" }), pin("b", 10, 0, { portal: true, targetPinId: "a", hidden: true })];
	const visible = (p: MapPin) => !p.hidden;
	const links = portalLinks(pins, visible);
	t("ida y vuelta con uno oculto: solo la flecha del visible, de ida", [links.length, links[0].both, links[0].colorKey], [1, false, "a"]);
}
{
	const pins = [pin("a", 0, 0, { portal: true, targetPinId: "b", hidden: true }), pin("b", 10, 0)];
	t("portal oculto: sin flecha", portalLinks(pins, (p) => !p.hidden), []);
}
{
	const pins = [pin("a", 3, 3, { portal: true, target: { x: 3, y: 3, zoom: 1 } })];
	t("destino en el mismo punto: sin flecha", portalLinks(pins, all), []);
}

t("color: fijo para un id (no cambia al redibujar)", portalColor("abc"), "hsl(234, 75%, 55%)");
t("color: distinto para otro id", portalColor("abc") !== portalColor("abd"), true);
t("color: en HSL", /^hsl\(\d{1,3}, 75%, 55%\)$/.test(portalColor("zona-1")), true);
