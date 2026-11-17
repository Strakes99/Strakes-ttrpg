// Visible para jugadores: el elemento, su tipo y su capa (si tiene) tienen que estar marcados.
// Lo que no tiene el campo (mapas anteriores a la 1.2) cuenta como oculto a los jugadores.
import { emptyMap, isPlayerVisible, normalizeMap } from "../src/map/mapData";
import { t } from "./helpers";

// Mapa antiguo, sin ningún campo nuevo: todo oculto a los jugadores y visible para el DM.
const old = normalizeMap({
	layers: [{ id: "L", name: "Capa", visible: true }],
	pins: [{ id: "p", x: 1, y: 1, layerId: "L" }],
	nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
	routes: [{ id: "r", name: "R", nodeIds: ["a", "b"] }],
});
t("mapa antiguo: tipo de marcadores oculto a jugadores", old.playerPins, false);
t("mapa antiguo: tipo de rutas oculto a jugadores", old.playerRoutes, false);
t("mapa antiguo: capa oculta a jugadores", old.layers[0].players, undefined);
t("mapa antiguo: marcador oculto a jugadores", isPlayerVisible(old, "pins", old.pins[0]), false);
t("mapa antiguo: el marcador sigue visible para el DM", old.pins[0].hidden, undefined);
t("mapa antiguo: ruta oculta a jugadores", isPlayerVisible(old, "routes", old.routes[0]), false);

// Mapa nuevo: los tipos empiezan ocultos a jugadores.
const fresh = emptyMap("img.png", 100, 100, "km");
t("mapa nuevo: marcadores ocultos a jugadores", fresh.playerPins, false);
t("mapa nuevo: rutas ocultas a jugadores", fresh.playerRoutes, false);

// Las tres condiciones a la vez.
const m = normalizeMap({
	playerPins: true,
	playerRoutes: true,
	layers: [
		{ id: "on", name: "Visible", visible: true, players: true },
		{ id: "off", name: "Oculta", visible: true },
	],
	pins: [
		{ id: "a", x: 0, y: 0, layerId: null, players: true },
		{ id: "b", x: 0, y: 0, layerId: "on", players: true },
		{ id: "c", x: 0, y: 0, layerId: "off", players: true },
		{ id: "d", x: 0, y: 0, layerId: "on" },
	],
});
const pin = (id: string) => m.pins.find((p) => p.id === id)!;
t("sin capa, marcado y tipo visible → lo ven", isPlayerVisible(m, "pins", pin("a")), true);
t("capa visible para jugadores → lo ven", isPlayerVisible(m, "pins", pin("b")), true);
t("capa oculta a jugadores → no lo ven", isPlayerVisible(m, "pins", pin("c")), false);
t("el marcador sin marcar → no lo ven", isPlayerVisible(m, "pins", pin("d")), false);
m.playerPins = false;
t("tipo oculto a jugadores → no lo ven", isPlayerVisible(m, "pins", pin("a")), false);

// La vista del DM es independiente: ocultar con el ojo no cambia lo que ven los jugadores.
m.playerPins = true;
pin("a").hidden = true;
t("oculto para el DM pero marcado → los jugadores lo ven", isPlayerVisible(m, "pins", pin("a")), true);

// Solo se guarda true: false y valores raros quedan sin definir.
const n = normalizeMap({ pins: [{ id: "x", x: 0, y: 0, players: false, hidden: "sí" }], layers: [{ id: "l", name: "l", visible: true, players: 1 }] });
t("players: false → sin definir", n.pins[0].players, undefined);
t("hidden no booleano → sin definir", n.pins[0].hidden, undefined);
t("players de capa no booleano → sin definir", n.layers[0].players, undefined);
