// Mayús para líneas rectas (1.3.2): 0°, 45° y 90° desde el origen.
import { constrainAngle } from "../src/map/geometry";
import { t } from "./helpers";

const o = { x: 100, y: 100 };
const r = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

t("casi horizontal → horizontal (misma y)", constrainAngle(o, { x: 200, y: 110 }), { x: 200, y: 100 });
t("casi vertical → vertical (misma x)", constrainAngle(o, { x: 95, y: 30 }), { x: 100, y: 30 });
t("hacia la izquierda", constrainAngle(o, { x: 20, y: 104 }), { x: 20, y: 100 });
t("diagonal: proyección sobre 45°", r(constrainAngle(o, { x: 200, y: 190 })), { x: 195, y: 195 });
t("diagonal hacia abajo a la izquierda", r(constrainAngle(o, { x: 0, y: 10 })), { x: 5, y: 5 });
t("diagonal hacia arriba a la izquierda", r(constrainAngle(o, { x: 0, y: 190 })), { x: 5, y: 195 });
t("ya alineado: sin cambio", constrainAngle(o, { x: 150, y: 150 }), { x: 150, y: 150 });
t("en el origen: sin cambio", constrainAngle(o, { x: 100, y: 100 }), { x: 100, y: 100 });
// Límite entre horizontal (0°) y diagonal (45°): a 22,5°.
t("a 20°: horizontal", constrainAngle(o, { x: 100 + Math.cos(0.349) * 100, y: 100 + Math.sin(0.349) * 100 }).y, 100);
t("a 25°: diagonal", (() => { const p = constrainAngle(o, { x: 100 + Math.cos(0.436) * 100, y: 100 + Math.sin(0.436) * 100 }); return Math.abs(p.x - 100 - (p.y - 100)) < 1e-9; })(), true);
