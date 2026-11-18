// Niebla de guerra (1.3): qué queda cubierto según los trazos del pincel, y su validación.
import { DEFAULT_FOG_COLOR, fogCovers, normalizeFog } from "../src/map/fogData";
import { normalizeMap } from "../src/map/mapData";
import { t } from "./helpers";

const fog = (strokes: { mode: "reveal" | "cover"; width: number; points: { x: number; y: number }[] }[], enabled = true) => ({
	enabled,
	color: "#000000",
	strokes,
});

// Sin niebla o desactivada: nada está cubierto.
t("sin niebla: descubierto", fogCovers(undefined, { x: 5, y: 5 }), false);
t("desactivada: descubierto", fogCovers(fog([], false), { x: 5, y: 5 }), false);

// Activada sin trazos: todo cubierto.
t("recién activada: todo cubierto", fogCovers(fog([]), { x: 5, y: 5 }), true);

// Un trazo de descubrir de 10 px de grosor de (0,0) a (100,0).
const reveal = { mode: "reveal" as const, width: 10, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
t("sobre el trazo: descubierto", fogCovers(fog([reveal]), { x: 50, y: 4 }), false);
t("fuera del trazo: cubierto", fogCovers(fog([reveal]), { x: 50, y: 6 }), true);
t("más allá del extremo: cubierto", fogCovers(fog([reveal]), { x: 106, y: 0 }), true);

// El orden importa: descubrir y luego cubrir encima.
const cover = { mode: "cover" as const, width: 20, points: [{ x: 50, y: 0 }] };
t("descubrir y luego cubrir un punto: cubierto", fogCovers(fog([reveal, cover]), { x: 50, y: 0 }), true);
t("el resto del trazo sigue descubierto", fogCovers(fog([reveal, cover]), { x: 90, y: 0 }), false);
t("cubrir y luego descubrir: descubierto", fogCovers(fog([cover, reveal]), { x: 50, y: 0 }), false);

// Un clic (trazo de un solo punto) descubre un círculo.
const dot = { mode: "reveal" as const, width: 10, points: [{ x: 0, y: 0 }] };
t("clic: dentro del círculo, descubierto", fogCovers(fog([dot]), { x: 3, y: 3 }), false);
t("clic: fuera del círculo, cubierto", fogCovers(fog([dot]), { x: 4, y: 4 }), true);

// Validación
t("sin niebla en el archivo", normalizeFog(undefined), undefined);
const n = normalizeFog({ enabled: true, strokes: [reveal, { mode: "otro", width: 5, points: [{ x: 0, y: 0 }] }, { mode: "cover", width: 0, points: [{ x: 0, y: 0 }] }, { mode: "cover", width: 5, points: [] }] });
t("color por defecto", n?.color, DEFAULT_FOG_COLOR);
t("solo quedan los trazos válidos", n?.strokes.length, 1);
t("activada se conserva", n?.enabled, true);
t("activada no booleana → desactivada", normalizeFog({ enabled: "sí" })?.enabled, false);
t("el mapa la lee", normalizeMap({ fog: { enabled: true, color: "#123456", strokes: [] } }).fog, { enabled: true, color: "#123456", strokes: [] });
t("mapa sin niebla", normalizeMap({}).fog, undefined);
