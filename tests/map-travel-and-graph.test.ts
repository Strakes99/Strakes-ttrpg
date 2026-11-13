import { emptyMap, segmentTime, legsTime, formatTravelTime, formatHours, parseHoursInput, milesPerUnit, distanceTime, deleteNode, splitSegment, reverseRoute, normalizeMap } from "../src/map/mapData";
import type { MapRoute } from "../src/map/mapData";
import { t } from "./helpers";
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

const d = emptyMap("x.png", 1000, 1000, "mi");
d.nodes.push({ id: "A", x: 0, y: 0 }, { id: "B", x: 100, y: 0 }, { id: "C", x: 200, y: 0 });
const r: MapRoute = { id: "r", name: "r", layerId: null, color: "", nodeIds: ["A", "B", "C"], segments: [24, 12], times: [null, 10], bends: [[], []] };
d.routes.push(r);
// Tramo 1: 24 millas sin tiempo manual -> desde distancia
t("normal desde distancia 24mi/3mph = 8h", near(segmentTime(d, r, 0, "normal").hours, 8), true);
t("rápido desde distancia 24/4 = 6h", near(segmentTime(d, r, 0, "fast").hours, 6), true);
t("lento desde distancia 24/2 = 12h", near(segmentTime(d, r, 0, "slow").hours, 12), true);
// Tramo 2: tiempo manual 10h (normal) tiene prioridad sobre la distancia (12mi = 4h)
t("manual normal = 10h", segmentTime(d, r, 1, "normal"), { hours: 10, manual: true });
t("manual rápido = 10*3/4 = 7.5h", near(segmentTime(d, r, 1, "fast").hours, 7.5), true);
t("manual lento = 10*3/2 = 15h", near(segmentTime(d, r, 1, "slow").hours, 15), true);
const legs = [{ routeId: "r", seg: 0, reversed: false }, { routeId: "r", seg: 1, reversed: false }];
t("total normal 8+10 = 18h", legsTime(d, legs, "normal"), { hours: 18, unknown: 0 });
// Días: normal 8h/día -> 18h = 2 días y 2 h
t("formato normal", formatTravelTime(18, "normal"), "2 días y 2 h (18 h de marcha, 8 h/día)");
t("formato rápido 7.5h/día: 15h = 2 días exactos", formatTravelTime(15, "fast"), "2 días (15 h de marcha, 7,5 h/día)");
t("formato lento 9h/día: 4h", formatTravelTime(4, "slow"), "4 h");
t("formatHours 6.5", formatHours(6.5), "6 h 30 min");
t("formatHours 0.75", formatHours(0.75), "45 min");
// Unidades
t("km -> mi", near(milesPerUnit("km"), 0.621371), true);
t("leguas", milesPerUnit("Leguas"), 3);
t("días: desconocida", milesPerUnit("días"), null);
d.unit = "km";
t("100 km a paso normal ≈ 20.7h", near(distanceTime(d, 100, "normal"), 100 / 1.609344 / 3), true);
d.unit = "días";
t("unidad desconocida: tramo sin tiempo manual -> null", segmentTime(d, r, 0, "normal").hours, null);
t("unidad desconocida: tramo con tiempo manual sigue funcionando", segmentTime(d, r, 1, "normal").hours, 10);
t("total con un tramo desconocido", legsTime(d, legs, "normal"), { hours: 10, unknown: 1 });
// Entrada de horas
t("parse 6", parseHoursInput("6"), 6);
t("parse 6,5", parseHoursInput("6,5"), 6.5);
t("parse 6h 30m", parseHoursInput("6h 30m"), 6.5);
t("parse 6 h 30 min", parseHoursInput("6 h 30 min"), 6.5);
t("parse 45 min", parseHoursInput("45 min"), 0.75);
t("parse 1h30", parseHoursInput("1h30"), 1.5);
t("parse basura", parseHoursInput("mucho"), null);
// Operaciones de ruta conservan los tiempos
d.unit = "mi";
const r2 = JSON.parse(JSON.stringify(r)) as MapRoute; d.routes = [r2];
splitSegment(d, r2, 1, { x: 150, y: 0 });
t("split reparte el tiempo manual 10h -> 5+5", r2.times, [null, 5, 5]);
deleteNode(d, r2.nodeIds[2]);
t("deleteNode suma tiempos", r2.times, [null, 10]);
reverseRoute(r2);
t("reverse invierte tiempos", r2.times, [10, null]);
t("normalize rellena times", normalizeMap({ routes: [{ id: "x", nodeIds: ["A", "B", "C"], segments: [1, 2] }], nodes: [] }).routes[0].times, [null, null]);
