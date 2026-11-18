// Zonas (1.3): geometría, área con escala o manual, normalización y visibilidad.
import { DEFAULT_ZONE_COLOR, emptyMap, isItemVisible, isPlayerVisible, normalizeMap } from "../src/map/mapData";
import { displayArea, pointInPolygon, polygonArea, polygonCentroid, zoneArea } from "../src/map/zones";
import { t } from "./helpers";

const square = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 },
];

// Geometría
t("área de un cuadrado 10×10", polygonArea(square), 100);
t("el sentido de los vértices no cambia el área", polygonArea([...square].reverse()), 100);
t("centro del cuadrado", polygonCentroid(square), { x: 5, y: 5 });
t("punto dentro", pointInPolygon({ x: 3, y: 7 }, square), true);
t("punto fuera", pointInPolygon({ x: 12, y: 5 }, square), false);
const lShape = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 4 },
	{ x: 4, y: 4 },
	{ x: 4, y: 10 },
	{ x: 0, y: 10 },
];
t("forma en L: el hueco queda fuera", pointInPolygon({ x: 8, y: 8 }, lShape), false);
t("forma en L: el brazo queda dentro", pointInPolygon({ x: 2, y: 8 }, lShape), true);
t("forma en L: área 64", polygonArea(lShape), 64);
t("vértices alineados: centro = media", polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }]), { x: 2, y: 0 });

// Área: manual > escala > nada
const d = emptyMap("x.png", 100, 100, "km");
const zone = { id: "z", name: "Bosque", points: square, layerId: null, color: "#000", borderColor: "#000" };
t("sin escala ni área manual: sin área", zoneArea(d, zone), null);
d.scale = 0.5; // 0,5 km por píxel: 100 px² = 25 km²
t("con escala: calculada", zoneArea(d, zone), { value: 25, estimated: true });
t("manual: tiene prioridad", zoneArea(d, { ...zone, area: 40 }), { value: 40, estimated: false });

// Área para mostrar
t("área en su unidad", displayArea(25, "km", "map"), "25 km²");
t("km² → mi²", displayArea(2.589988, "km", "mi"), "1 mi²");
t("unidad que no es de longitud: tal cual", displayArea(3, "días", "km"), "3 días²");

// Normalización: valores por defecto, vértices inválidos, zonas con menos de 3 vértices
const m = normalizeMap({
	layers: [{ id: "L", name: "Capa", visible: true }],
	zones: [
		{ id: "a", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: "x", y: 0 }, { x: 1, y: 1 }], layerId: "nope" },
		{ id: "b", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
		{ id: "c" },
	],
});
t("solo queda la zona con 3 vértices válidos", m.zones.map((z) => z.id), ["a"]);
t("vértice inválido descartado", m.zones[0].points.length, 3);
t("nombre por defecto", m.zones[0].name, "");
t("capa inexistente → sin capa", m.zones[0].layerId, null);
t("color por defecto", m.zones[0].color, DEFAULT_ZONE_COLOR);
t("borde por defecto = relleno", m.zones[0].borderColor, DEFAULT_ZONE_COLOR);
t("mapa sin zonas: lista vacía", normalizeMap({}).zones, []);
t("tipo Zonas visible para el DM por defecto", normalizeMap({}).showZones, true);
t("tipo Zonas oculto a los jugadores por defecto", normalizeMap({}).playerZones, false);

// Visibilidad: igual que marcadores y rutas
const v = normalizeMap({ playerZones: true, zones: [{ id: "z", points: square, players: true }] });
t("zona marcada y tipo visible → la ven los jugadores", isPlayerVisible(v, "zones", v.zones[0]), true);
v.playerZones = false;
t("tipo oculto a jugadores → no la ven", isPlayerVisible(v, "zones", v.zones[0]), false);
v.showZones = false;
t("tipo apagado en la vista del DM", isItemVisible(v, "zones", null), false);
