// 1.3.2: cambiar la unidad del mapa conserva el tamaño real (escala, tramos y áreas manuales).
import { convertMapUnit, emptyMap, fieldNumber, MapData, milesPerUnit, unitFactor } from "../src/map/mapData";
import { t } from "./helpers";

const near = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

function sample(unit: string): MapData {
	const d = emptyMap("x.png", 1000, 1000, unit);
	// Una cuadrícula de 50 px mide 5 unidades.
	d.scale = 5 / 50;
	d.routes.push({ id: "r", name: "Ruta", layerId: null, color: "#f00", nodeIds: ["a", "b", "c"], segments: [100, null], times: [2, null] });
	d.zones.push({ id: "z1", name: "Con área", points: [], layerId: null, color: "#0f0", borderColor: "#0f0", area: 100 });
	d.zones.push({ id: "z2", name: "Sin área", points: [], layerId: null, color: "#0f0", borderColor: "#0f0" });
	return d;
}

t("factor: ft → m", near(unitFactor("ft", "m"), 0.3048), true);
t("factor: nombres escritos a mano (pies → metros)", near(unitFactor("pies", "metros"), 0.3048), true);
t("factor: unidad no reconocida", [unitFactor("días", "km"), unitFactor("km", "días")], [null, null]);
t("leguas: se siguen reconociendo escritas a mano", milesPerUnit("leguas"), 3);

{
	const d = sample("ft");
	convertMapUnit(d, "m");
	t("ft → m: la unidad", d.unit, "m");
	t("ft → m: la cuadrícula de 5 ft mide 1,524 m", near((d.scale ?? 0) * 50, 1.524), true);
	t("ft → m: tramo manual 100 ft → 30,48 m", near(d.routes[0].segments[0], 30.48), true);
	t("ft → m: tramo sin distancia sigue sin ella", d.routes[0].segments[1], null);
	t("ft → m: los tiempos manuales no cambian", d.routes[0].times, [2, null]);
	t("ft → m: área manual 100 ft² → 9,290304 m²", near(d.zones[0].area, 9.290304), true);
	t("ft → m: zona sin área sigue sin ella", d.zones[1].area, undefined);
}

{
	const d = sample("ft");
	convertMapUnit(d, "m");
	convertMapUnit(d, "ft");
	t("ida y vuelta ft → m → ft: escala", near(d.scale, 0.1), true);
	t("ida y vuelta ft → m → ft: tramo", near(d.routes[0].segments[0], 100), true);
	t("ida y vuelta ft → m → ft: área", near(d.zones[0].area, 100), true);
}

{
	const d = sample("km");
	convertMapUnit(d, "mi");
	t("km → mi: escala", near(d.scale, 0.1 / 1.609344), true);
}

{
	const d = sample("km");
	convertMapUnit(d, "días");
	t("a una unidad no reconocida: solo la etiqueta", [d.unit, d.scale, d.routes[0].segments[0], d.zones[0].area], ["días", 0.1, 100, 100]);
	convertMapUnit(d, "km");
	t("desde una unidad no reconocida: solo la etiqueta", [d.unit, d.scale, d.routes[0].segments[0], d.zones[0].area], ["km", 0.1, 100, 100]);
}

{
	const d = sample("pies");
	convertMapUnit(d, "ft");
	t("misma unidad con otro nombre: solo la etiqueta", [d.unit, d.scale, d.routes[0].segments[0]], ["ft", 0.1, 100]);
}

{
	const d = sample("ft");
	d.scale = null;
	convertMapUnit(d, "m");
	t("sin escala: sigue sin escala y los tramos se convierten", [d.scale, near(d.routes[0].segments[0], 30.48)], [null, true]);
}

// Los campos de los diálogos muestran como mucho 2 decimales (el valor guardado no cambia).
t("campo: ruido de la conversión → 10", fieldNumber(9.999999999999998), "10");
t("campo: 30,48 se queda", fieldNumber(30.48), "30.48");
t("campo: 9,290304 → 9,29", fieldNumber(9.290304), "9.29");
t("campo: muy pequeño, 2 cifras significativas", fieldNumber(0.0042137), "0.0042");
t("campo: cero", fieldNumber(0), "0");
t("campo: negativo", fieldNumber(-2.345), "-2.35");
