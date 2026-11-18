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

// Notas en las rutas (1.3): enlace y AUTO opcionales.
const withLink = normalizeMap({ nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }], routes: [{ id: "r", name: "Camino", nodeIds: ["a", "b"], link: "[[Camino Real]]", autoName: true }, { id: "s", name: "Senda", nodeIds: ["a", "b"], link: "  ", autoName: "sí" }] });
t("ruta: enlace válido se conserva", withLink.routes[0].link, "[[Camino Real]]");
t("ruta: AUTO marcada se conserva", withLink.routes[0].autoName, true);
t("ruta: enlace vacío → sin enlace", withLink.routes[1].link, undefined);
t("ruta: AUTO no booleana → sin definir", withLink.routes[1].autoName, undefined);
