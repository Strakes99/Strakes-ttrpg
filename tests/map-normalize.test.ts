// Mapas escritos a mano: normalizeMap rellena lo que falta.
import { normalizeMap } from "../src/map/mapData";
import { t } from "./helpers";

// Sin unidad en el archivo: la de los ajustes.
t("sin unidad → la de los ajustes", normalizeMap({}, "millas").unit, "millas");
t("con unidad → la del archivo", normalizeMap({ unit: "leguas" }, "millas").unit, "leguas");
t("sin ajuste → km", normalizeMap({}).unit, "km");

// Ruta y marcador sin nombre.
const m = normalizeMap({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }], routes: [{ id: "r", nodeIds: ["a", "b"] }], pins: [{ id: "p", x: 1, y: 1 }] });
t("ruta sin nombre → \"\"", m.routes[0].name, "");
t("el nombre admite .trim() (lo que usaba la etiqueta)", m.routes[0].name.trim(), "");
t("marcador sin nombre → \"\"", m.pins[0].name, "");

// Distancias negativas: se conservan.
t("distancia negativa se conserva", normalizeMap({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }], routes: [{ id: "r", name: "x", nodeIds: ["a", "b"], segments: [-5] }] }).routes[0].segments[0], -5);
