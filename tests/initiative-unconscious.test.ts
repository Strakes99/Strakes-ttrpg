import { combatantConditions } from "../src/initiative/conditions";
import { InitiativeTracker } from "../src/initiative/tracker";
import type { Combatant } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";
clearNotices();
const plugin = fakePlugin();
const tr = new InitiativeTracker(plugin);
// Condiciones guardadas, más «unconscious@» si Inconsciente se aplica sola (ya no se guarda).
const ids = (c: Combatant) => [
	...c.conditions.map((e) => e.id),
	...(combatantConditions(c, plugin.settings).some((a) => a.auto && a.info.id === "unconscious") ? ["unconscious@"] : []),
];

const npc = tr.add({ name: "Orco", initiative: 8, hp: 10, maxHp: 15 });
tr.damage(npc.id, 14);
t("enemigo: PG negativos", npc.hp, -4);
t("enemigo: sin Inconsciente automática", ids(npc), []);

const pj = tr.add({ name: "Clériga", initiative: 15, hp: 6, maxHp: 20, isPlayer: true });
tr.damage(pj.id, 9);
t("PJ: PG negativos", pj.hp, -3);
t("PJ: Inconsciente automática al llegar a 0 o menos", ids(pj), ["unconscious@"]);
tr.damage(pj.id, 2);
t("PJ: no se duplica", ids(pj), ["unconscious@"]);
tr.heal(pj.id, 5);
t("curar hasta 0 (-5 + 5): sigue inconsciente", [pj.hp, ids(pj)], [0, ["unconscious@"]]);
tr.heal(pj.id, 4);
t("subir de 0: se quita y sigue Derribado", [pj.hp, ids(pj)], [4, ["prone"]]);
t("avisos", [notices().includes("Clériga: Inconsciente (0 PG o menos)."), notices().includes("Clériga: termina Inconsciente (sigue Derribado).")], [true, true]);

// Inconsciente puesta a mano: no se quita al curar
const pj2 = tr.add({ name: "Bardo", initiative: 14, hp: 10, maxHp: 10, isPlayer: true });
tr.addCondition(pj2.id, "unconscious");
tr.damage(pj2.id, 15); tr.heal(pj2.id, 10);
t("Inconsciente manual (conjuro) se respeta", ids(pj2), ["unconscious"]);

// Editar PG a mano a 0 también aplica
const pj3 = tr.add({ name: "Pícaro", initiative: 13, hp: 8, maxHp: 8, isPlayer: true });
tr.update(pj3.id, { hp: 0 });
t("PG a mano a 0", ids(pj3), ["unconscious@"]);
clearNotices();
tr.update(pj3.id, { isPlayer: false });
t("deja de ser PJ: se quita la automática, sin Derribado", ids(pj3), []);
t("deja de ser PJ: sin avisos", notices(), []);
// …y subir los PG a mano desde 0 deja Derribado
const pj3b = tr.add({ name: "Monje", initiative: 12, hp: 0, maxHp: 8, isPlayer: true });
tr.update(pj3b.id, { hp: 3 });
t("PG a mano de 0 a 3: sigue Derribado", ids(pj3b), ["prone"]);
// Concentración se pierde al caer
const pj4 = tr.add({ name: "Mago", initiative: 9, hp: 5, maxHp: 12, isPlayer: true });
tr.addCondition(pj4.id, "concentration");
tr.damage(pj4.id, 7);
t("concentración perdida al caer inconsciente", ids(pj4), ["unconscious@"]);

// La Inconsciente automática se muestra como automática, igual que Ensangrentado.
const pj5 = tr.add({ name: "Clériga", initiative: 7, hp: 3, maxHp: 10, isPlayer: true });
tr.damage(pj5.id, 5);
const shown = combatantConditions(pj5, plugin.settings).find((a) => a.info.id === "unconscious");
t("Inconsciente por PG: se marca como automática", shown?.auto, true);
t("motivo que se muestra", shown?.reason, "0 PG o menos");
const pj6 = tr.add({ name: "Bardo", initiative: 6, hp: 10, maxHp: 10, isPlayer: true });
tr.addCondition(pj6.id, "unconscious");
const manual = combatantConditions(pj6, plugin.settings).find((a) => a.info.id === "unconscious");
t("Inconsciente puesta a mano: no se marca como automática", [manual?.auto ?? false, manual?.explicit], [false, true]);
