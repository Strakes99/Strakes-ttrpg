// Unidades al mostrar (1.3.2): cada mapa se ve en su unidad, sin conversión. El ajuste general solo
// decide la unidad de los mapas nuevos; para cambiar la de un mapa se convierte (map-unit-change).
import { distanceTime, emptyMap, formatDistance, formatTotal, milesPerUnit, paceSpeed } from "../src/map/mapData";
import { displayArea } from "../src/map/zones";
import { t } from "./helpers";

t("distancia: en la unidad del mapa", formatDistance(3.14, "km"), "3,1 km");
t("distancia: desde 100, sin decimales", formatDistance(123.4, "ft"), "123 ft");
t("distancia: unidad escrita a mano", formatDistance(3, "días"), "3 días");
t("total: en la unidad del mapa", formatTotal({ total: 100, unknown: 1, segments: 3 }, "mi"), "100 mi + 1 tramo sin distancia");
t("total: sin tramos", formatTotal({ total: 0, unknown: 0, segments: 0 }, "mi"), "—");

t("área: en la unidad del mapa", displayArea(12.5, "km"), "12,5 km²");
t("área: hasta 2 decimales", displayArea(9.290304, "m"), "9,29 m²");
t("área: desde 100, sin decimales", displayArea(929.03, "m"), "929 m²");


// Velocidad de los pasos de viaje: en el sistema del mapa.
t("velocidad: mapa en km → km/h", paceSpeed(3, "km"), "4,8 km/h");
t("velocidad: mapa en m → km/h", paceSpeed(3, "m"), "4,8 km/h");
t("velocidad: mapa en metros escritos a mano → km/h", paceSpeed(3, "metros"), "4,8 km/h");
t("velocidad: mapa en mi → millas/h", paceSpeed(3, "mi"), "3 millas/h");
t("velocidad: mapa en ft → millas/h", paceSpeed(3, "ft"), "3 millas/h");
t("velocidad: mapa en leguas → millas/h", paceSpeed(3, "leguas"), "3 millas/h");
t("velocidad: unidad no reconocida → millas/h", paceSpeed(4, "días"), "4 millas/h");

t("km factor", Math.abs((milesPerUnit("km") ?? 0) - 0.621371) < 1e-6, true);
const d = emptyMap("x.png", 100, 100, "km");
t("tiempo: 4,828 km a paso normal, 1 h", Math.abs((distanceTime(d, 4.828032, "normal") ?? 0) - 1) < 1e-9, true);
const ftMap = emptyMap("x.png", 100, 100, "ft");
t("tiempo: 5280 ft a paso normal, 20 min", Math.abs((distanceTime(ftMap, 5280, "normal") ?? 0) - 1 / 3) < 1e-9, true);
