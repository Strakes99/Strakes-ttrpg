// 1.4: condiciones ocultas, PG máximos con una automática y lanzador que sale del combate.
import { activeConditions } from "../src/initiative/conditions";
import { InitiativeTracker } from "../src/initiative/tracker";
import { Combatant } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";

// Los avisos con botones (salvaciones) usan createFragment, global de Obsidian: un sustituto mínimo.
interface FakeEl { createDiv(o?: { text?: string }): FakeEl; createEl(tag: string, o?: { text?: string }): FakeEl }
const fakeEl = (): FakeEl => ({ createDiv: () => fakeEl(), createEl: () => fakeEl() });
(globalThis as Record<string, unknown>).createFragment = () => fakeEl();

function combat() {
	const plugin = fakePlugin();
	const tr = new InitiativeTracker(plugin);
	// Orden por iniciativa: Mago (20), Orco (15), Goblin (10).
	const mage = tr.add({ name: "Mago", initiative: 20, hp: 20, maxHp: 20, isPlayer: true });
	const orc = tr.add({ name: "Orco", initiative: 15, hp: 15, maxHp: 15 });
	const goblin = tr.add({ name: "Goblin", initiative: 10, hp: 7, maxHp: 7 });
	return { plugin, tr, mage, orc, goblin };
}
const has = (c: Combatant, id: string) => c.conditions.some((e) => e.id === id);
/** Las automáticas (Ensangrentado) no se guardan en el combatiente: se calculan. */
const shows = (plugin: ReturnType<typeof fakePlugin>, c: Combatant, id: string) =>
	activeConditions(c.conditions, plugin.settings, { isPlayer: c.isPlayer, hp: c.hp, maxHp: c.maxHp }).some((a) => a.info.id === id);

// ---------- Condición oculta: no cuenta mientras lo esté ----------
{
	const { plugin, tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntryDuration(orc.id, "frightened", { kind: "turn-end", of: "target" });
	// Se oculta Asustado en los ajustes.
	plugin.settings.conditionOverrides.frightened = { hidden: true };
	clearNotices();
	tr.next(); // empieza el turno del Orco
	tr.next(); // termina el turno del Orco
	t("oculta: su duración no avanza (sigue en el combatiente)", has(orc, "frightened"), true);
	t("oculta: no avisa", notices().some((n) => n.includes("Asustado")), false);
	// Se vuelve a mostrar: sigue donde estaba.
	delete plugin.settings.conditionOverrides.frightened;
	tr.next(); // Goblin
	tr.next(); // Mago
	tr.next(); // empieza el turno del Orco
	tr.next(); // termina el turno del Orco
	t("vuelta a mostrar: termina al acabar el turno del Orco", has(orc, "frightened"), false);
}
{
	// La repetición de la salvación tampoco avisa mientras está oculta.
	const { plugin, tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntrySave(orc.id, "frightened", { ability: "Sabiduría", when: "start" });
	plugin.settings.conditionOverrides.frightened = { hidden: true };
	clearNotices();
	tr.next(); // empieza el turno del Orco: tocaría repetir la salvación
	t("oculta: no repite la salvación", notices().some((n) => n.includes("repite la salvación")), false);
}

// ---------- PG máximos: una automática que termina por ellos deja lo suyo y avisa ----------
{
	const { plugin, tr, orc } = combat();
	// Ensangrentado que, al terminar, deja Derribado y avisa.
	plugin.settings.conditionOverrides.bloodied = { rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "all" }], leaves: ["prone"], announce: true } };
	tr.update(orc.id, { hp: 10, maxHp: 30 });
	t("10 de 30 PG: Ensangrentado", shows(plugin, orc, "bloodied"), true);
	clearNotices();
	tr.update(orc.id, { maxHp: 18 });
	t("máximo a 18: termina Ensangrentado", shows(plugin, orc, "bloodied"), false);
	t("máximo a 18: deja Derribado", has(orc, "prone"), true);
	t("máximo a 18: avisa", notices().length > 0, true);
}
{
	// Cambiar de bando sigue sin «curar»: no deja nada.
	const { plugin, tr, orc } = combat();
	plugin.settings.conditionOverrides.bloodied = { rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "enemies" }], leaves: ["prone"], announce: true } };
	tr.update(orc.id, { hp: 5 });
	t("enemigo a 5 de 15: Ensangrentado (solo enemigos)", shows(plugin, orc, "bloodied"), true);
	tr.update(orc.id, { isPlayer: true });
	t("pasa a PJ: termina Ensangrentado", shows(plugin, orc, "bloodied"), false);
	t("pasa a PJ: no deja Derribado", has(orc, "prone"), false);
}

// ---------- Lanzador que sale del combate: cuenta el turno del afectado ----------
{
	const { tr, mage, orc, goblin } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntryCaster(orc.id, "frightened", { id: mage.id });
	tr.setEntryDuration(orc.id, "frightened", { kind: "turn-end", of: "caster" });
	tr.remove(mage.id); // el Mago sale del combate
	tr.setCurrent(goblin.id);
	tr.next(); // empieza el turno del Orco (como en las demás, cuenta un turno que empieza después)
	t("sin lanzador: sigue durante el turno del afectado", has(orc, "frightened"), true);
	tr.next(); // termina el turno del Orco
	t("sin lanzador: termina al acabar el siguiente turno del afectado", has(orc, "frightened"), false);
}
{
	const { tr, mage, orc, goblin } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntryCaster(orc.id, "frightened", { id: mage.id });
	tr.setEntryDuration(orc.id, "frightened", { kind: "turn-start", of: "caster" });
	tr.remove(mage.id);
	tr.setCurrent(goblin.id);
	tr.next(); // empieza el turno del Orco
	t("sin lanzador (inicio de turno): termina al empezar el turno del afectado", has(orc, "frightened"), false);
}
