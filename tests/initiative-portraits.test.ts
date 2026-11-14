import { placeholderLabel, splitName, memoryKey, coverCrop, fitCrop } from "../src/initiative/portrait";
import { InitiativeTracker } from "../src/initiative/tracker";
import { fakePlugin, t } from "./helpers";
t("G1..G5", [1, 2, 3, 4, 5].map((n) => placeholderLabel(`Goblin ${n}`)), ["G1", "G2", "G3", "G4", "G5"]);
t("sin número", placeholderLabel("Strahd von Zarovich"), "S");
t("acentos", placeholderLabel("Ángel 12"), "Á12");
t("splitName", splitName("Lobo terrible 3"), { base: "Lobo terrible", number: "3" });
t("memoryKey sin número ni mayúsculas", memoryKey("Goblin 4"), "goblin");
t("cover horizontal 2:1", coverCrop("a.png", 200, 100), { path: "a.png", scale: 2, x: -0.5, y: 0 });
t("cover vertical 1:2 (cuerpo entero)", coverCrop("a.png", 100, 200), { path: "a.png", scale: 1, x: 0, y: -0.5 });
t("fit vertical 1:2", fitCrop("a.png", 100, 200), { path: "a.png", scale: 0.5, x: 0.25, y: 0 });
const plugin = fakePlugin();
const tr = new InitiativeTracker(plugin);
const face = { path: "Retratos/goblin.png", x: -0.2, y: -0.1, scale: 1.6 };
const g1 = tr.add({ name: "Goblin 1", initiative: 10, portrait: face });
t("retrato elegido se recuerda por nombre", plugin.settings.portraitMemory["goblin"], face);
const g2 = tr.add({ name: "Goblin 2", initiative: 9 });
t("siguiente Goblin recibe el retrato recordado", g2.portrait, face);
t("copia, no la misma referencia", g2.portrait !== g1.portrait, true);
const o = tr.add({ name: "Orco", initiative: 8 });
t("nombre sin memoria: sin retrato", o.portrait, null);
tr.setPortrait(g2.id, null);
t("quitar retrato lo olvida", plugin.settings.portraitMemory["goblin"], undefined);

// Alta con «sin retrato» (quitado en el formulario): no recupera el recordado para ese nombre.
{
	const pl = fakePlugin();
	const trk = new InitiativeTracker(pl);
	trk.add({ name: "Lobo 1", initiative: 10, portrait: { path: "lobo.png", x: 0, y: 0, scale: 1 } });
	const recalled = trk.add({ name: "Lobo 2", initiative: 9 });
	t("con retrato recordado, un alta normal lo usa", recalled.portrait?.path, "lobo.png");
	const without = trk.add({ name: "Lobo 3", initiative: 8, portrait: null });
	t("un alta con portrait: null queda sin retrato", without.portrait, null);
}
