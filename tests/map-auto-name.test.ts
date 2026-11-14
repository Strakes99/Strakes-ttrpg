// Nombre automático de los marcadores (casilla AUTO).
import { applyAutoNames, autoPinName, AutoNamePin, nameFromLink, plainText } from "../src/map/autoName";
import { t } from "./helpers";

// Del enlace: alias > último encabezado > nota.
t("nota", nameFromLink("[[Barovia]]"), "Barovia");
t("nota en carpeta", nameFromLink("[[Lugares/Barovia]]"), "Barovia");
t("encabezado", nameFromLink("[[Barovia#La iglesia]]"), "La iglesia");
t("encabezados anidados: el último", nameFromLink("[[Barovia#Capítulo 2#La iglesia]]"), "La iglesia");
t("alias por encima del encabezado", nameFromLink("[[Barovia#La iglesia|Iglesia del pueblo]]"), "Iglesia del pueblo");
t("bloque: nombre de la nota", nameFromLink("[[Barovia#^a1b2c3]]"), "Barovia");
t("mapa enlazado: sin extensión", nameFromLink("[[Castillo.smap]]"), "Castillo");
t("lienzo enlazado: sin extensión", nameFromLink("[[Plan.canvas]]"), "Plan");
t("nota con puntos en el nombre", nameFromLink("[[Capítulo 1.2]]"), "Capítulo 1.2");
t("sin enlace", nameFromLink(undefined), null);
t("enlace vacío", nameFromLink("  "), null);

// Formato en encabezados y alias.
t("negrita, enlace e itálica fuera", plainText("La **Torre** de [[Strahd]] *von Zarovich*"), "La Torre de Strahd von Zarovich");
t("enlace con alias", plainText("Ver [[Personajes/Ireena|Ireena]]"), "Ver Ireena");
t("enlace markdown y código", plainText("[Guía](https://x.y) `v2`"), "Guía v2");
t("guiones bajos sueltos se respetan", plainText("mapa_viejo"), "mapa_viejo");

// Portales: toman el nombre del destino.
const pins: AutoNamePin[] = [
	{ id: "a", name: "Sótano", portal: false },
	{ id: "b", name: "", portal: true, targetPinId: "a", autoName: true },
	{ id: "c", name: "Capilla", link: "[[Barovia#Capilla]]", portal: true, targetPinId: "a", autoName: true },
];
t("portal sin nota: nombre del destino", autoPinName(pins[1], pins), "Sótano");
t("portal con nota: manda la nota", autoPinName(pins[2], pins), "Capilla");
t("portal a un punto fijo: sin nombre", autoPinName({ id: "x", portal: true, autoName: true }, pins), null);
t("no es portal: no mira el destino", autoPinName({ id: "y", portal: false, targetPinId: "a", autoName: true }, pins), null);
t("destino que no existe", autoPinName({ id: "z", portal: true, targetPinId: "nada", autoName: true }, pins), null);

// Dos escaleras que se apuntan entre sí: ninguna toma el nombre de la otra (si no, se intercambiarían).
const stairs: AutoNamePin[] = [
	{ id: "s1", name: "Escalera de arriba", portal: true, targetPinId: "s2", autoName: true },
	{ id: "s2", name: "Escalera de abajo", portal: true, targetPinId: "s1", autoName: true },
];
applyAutoNames(stairs);
applyAutoNames(stairs);
t("escaleras enfrentadas: conservan su nombre", stairs.map((p) => p.name), ["Escalera de arriba", "Escalera de abajo"]);
// Pero si el destino tiene nombre propio (a mano o de su nota), sí lo toman.
const pair: AutoNamePin[] = [
	{ id: "p1", name: "", portal: true, targetPinId: "p2", autoName: true },
	{ id: "p2", name: "", link: "[[Torre]]", portal: true, targetPinId: "p1", autoName: true },
];
applyAutoNames(pair);
t("escalera hacia un destino con nota", pair.map((p) => p.name), ["Torre", "Torre"]);
// Un destino que no es portal, con AUTO y sin nota, tiene nombre propio (puesto a mano): se toma.
const toPlain: AutoNamePin[] = [
	{ id: "q1", name: "", portal: true, targetPinId: "q2", autoName: true },
	{ id: "q2", name: "Pozo", autoName: true },
];
applyAutoNames(toPlain);
t("portal hacia un marcador normal con AUTO y sin nota", toPlain[0].name, "Pozo");

// applyAutoNames: solo toca los que tienen AUTO, y en orden (primero enlaces, luego portales).
const map: AutoNamePin[] = [
	{ id: "n", name: "Viejo", link: "[[Vallaki]]", autoName: true },
	{ id: "m", name: "A mano", link: "[[Krezk]]" },
	{ id: "q", name: "", portal: true, targetPinId: "n", autoName: true },
	{ id: "e", name: "Se queda", autoName: true },
];
t("devuelve si cambió algo", applyAutoNames(map), true);
t("nombres", map.map((p) => p.name), ["Vallaki", "A mano", "Vallaki", "Se queda"]);
t("sin cambios la segunda vez", applyAutoNames(map), false);
// Renombrar la nota (el plugin actualiza el enlace) arrastra el nombre y el del portal.
map[0].link = "[[Vallaki (pueblo)]]";
applyAutoNames(map);
t("tras renombrar la nota", [map[0].name, map[2].name], ["Vallaki (pueblo)", "Vallaki (pueblo)"]);
