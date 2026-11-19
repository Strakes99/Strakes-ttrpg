// Tamaño del pincel de niebla: límites y deslizador logarítmico (posición ↔ tamaño).
import { BRUSH_STEPS, brushPosition, brushSizeAt, brushSizeRange, clampBrushSize } from "../src/map/fogData";
import { t } from "./helpers";

const big = brushSizeRange(5000, 3000);
t("límites: imagen de 5000 px → de 2 a 1000", big, { min: 2, max: 1000 });
t("límites: imagen pequeña → al menos 200", brushSizeRange(400, 300), { min: 2, max: 200 });
t("límites: sin imagen → de 2 a 200", brushSizeRange(0, 0), { min: 2, max: 200 });

t("ajustar: por debajo del mínimo → mínimo", clampBrushSize(0, big), 2);
t("ajustar: por encima del máximo → máximo", clampBrushSize(5000, big), 1000);
t("ajustar: decimales → entero", clampBrushSize(45.6, big), 46);

t("deslizador: el principio es el mínimo", brushSizeAt(0, big), 2);
t("deslizador: el final es el máximo", brushSizeAt(BRUSH_STEPS, big), 1000);
// Logarítmico: 2 · 500^t.
t("deslizador: un cuarto ≈ 9 px", brushSizeAt(BRUSH_STEPS / 4, big), 9);
t("deslizador: la mitad ≈ 45 px", brushSizeAt(BRUSH_STEPS / 2, big), 45);
t("deslizador: tres cuartos ≈ 211 px", brushSizeAt((BRUSH_STEPS * 3) / 4, big), 211);
t("deslizador: fuera de rango se ajusta", [brushSizeAt(-10, big), brushSizeAt(BRUSH_STEPS + 10, big)], [2, 1000]);

t("posición: del mínimo y del máximo", [brushPosition(2, big), brushPosition(1000, big)], [0, BRUSH_STEPS]);
t("posición: fuera de los límites, en los extremos", [brushPosition(1, big), brushPosition(9999, big)], [0, BRUSH_STEPS]);

// Ida y vuelta: cada tamaño del rango sale igual o a medio paso del deslizador (cada paso, ×500^(1/1000)
// ≈ 0,62 %) más el redondeo a píxel entero. El campo numérico conserva el valor escrito.
let ok = true;
for (let px = big.min; px <= big.max; px++) {
	const back = brushSizeAt(brushPosition(px, big), big);
	if (Math.abs(back - px) > px * 0.0032 + 0.5) ok = false;
}
t("ida y vuelta: tamaño → posición → tamaño, a medio paso (más el redondeo)", ok, true);
let small = true;
for (let px = 2; px <= 100; px++) if (brushSizeAt(brushPosition(px, big), big) !== px) small = false;
t("ida y vuelta: de 2 a 100 px, exacto", small, true);
