// Camino más rápido frente al más corto (panel de medición).
import { emptyMap, fastestPath, samePath, shortestPath } from "../src/map/mapData";
import type { MapRoute } from "../src/map/mapData";
import { t } from "./helpers";

// A–B directo: 30 mi por un camino lento (tiempo manual 20 h a paso normal).
// A–C–B: 24 + 24 = 48 mi sin tiempo manual: 16 h a paso normal (3 mph).
const d = emptyMap("x.png", 1000, 1000, "mi");
d.nodes = [
	{ id: "A", x: 0, y: 0 },
	{ id: "B", x: 10, y: 0 },
	{ id: "C", x: 5, y: 5 },
];
const direct: MapRoute = { id: "dir", name: "Pantano", layerId: null, color: "", nodeIds: ["A", "B"], segments: [30], times: [20], bends: [[]] };
const around: MapRoute = { id: "rod", name: "Camino", layerId: null, color: "", nodeIds: ["A", "C", "B"], segments: [24, 24], times: [null, null], bends: [[], []] };
d.routes = [direct, around];

const short = shortestPath(d, d.routes, "A", "B")!;
const fast = fastestPath(d, d.routes, "A", "B")!;
t("más corta: el pantano (30 mi)", short.legs.map((l) => l.routeId), ["dir"]);
t("más corta: distancia", short.distance, 30);
t("más rápida: el camino (16 h < 20 h)", fast.legs.map((l) => l.routeId), ["rod", "rod"]);
t("más rápida: su distancia", fast.distance, 48);
t("más rápida: sin tramos sin distancia", fast.unknown, 0);
t("no son el mismo camino", samePath(short, fast), false);

// Con cualquier paso el más rápido es el mismo (todos los tiempos se escalan igual).
t("paso lento: mismo camino", samePath(fastestPath(d, d.routes, "A", "B", "slow")!, fast), true);
t("paso rápido: mismo camino", samePath(fastestPath(d, d.routes, "A", "B", "fast")!, fast), true);

// Si el pantano tarda menos, coinciden.
direct.times = [10];
t("pantano en 10 h: coinciden", samePath(shortestPath(d, d.routes, "A", "B")!, fastestPath(d, d.routes, "A", "B")!), true);

// Tramos sin tiempo posible (mapa en «días», sin tiempos manuales): se permiten como en la distancia.
const days = emptyMap("x.png", 1000, 1000, "días");
days.nodes = d.nodes;
days.routes = [{ id: "x", name: "x", layerId: null, color: "", nodeIds: ["A", "B"], segments: [3], times: [null], bends: [[]] }];
const noTime = fastestPath(days, days.routes, "A", "B")!;
t("sin tiempo: hay camino igualmente", noTime.legs.length, 1);
t("sin tiempo: conserva la distancia", noTime.distance, 3);
t("mismo nodo: camino vacío", fastestPath(d, d.routes, "A", "A")!.legs.length, 0);
