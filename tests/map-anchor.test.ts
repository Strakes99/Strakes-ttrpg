// Marcadores anclados a nodos: el ancla se quita sola si el nodo deja de existir.
import { deleteNode, normalizeMap, pruneNodes } from "../src/map/mapData";
import { t } from "./helpers";

const base = () =>
	normalizeMap({
		nodes: [
			{ id: "a", x: 0, y: 0 },
			{ id: "b", x: 10, y: 0 },
			{ id: "c", x: 20, y: 0 },
		],
		routes: [{ id: "r", name: "r", nodeIds: ["a", "b", "c"] }],
		pins: [
			{ id: "p", x: 10, y: 0, nodeId: "b" },
			{ id: "q", x: 5, y: 5, nodeId: "zz" },
			{ id: "s", x: 5, y: 5, nodeId: 3 },
		],
	});

const m = base();
t("ancla a un nodo que existe: se conserva", m.pins[0].nodeId, "b");
t("ancla a un nodo que no existe: se quita", m.pins[1].nodeId, undefined);
t("ancla que no es texto: se quita", m.pins[2].nodeId, undefined);

// Borrar el nodo del medio: el marcador se queda donde estaba, sin ancla.
const d = base();
deleteNode(d, "b");
t("borrar el nodo: el marcador queda suelto", d.pins[0].nodeId, undefined);
t("borrar el nodo: el marcador no se mueve", [d.pins[0].x, d.pins[0].y], [10, 0]);

// Borrar la ruta: sus nodos desaparecen y el ancla también.
const r = base();
r.routes = [];
pruneNodes(r);
t("borrar la ruta: el marcador queda suelto", r.pins[0].nodeId, undefined);

// Mientras el nodo sigue en uso, el ancla se mantiene.
const k = base();
pruneNodes(k);
t("nodo en uso: el ancla se mantiene", k.pins[0].nodeId, "b");
