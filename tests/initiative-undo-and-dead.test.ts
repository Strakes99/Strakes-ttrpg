import { InitiativeTracker } from "../src/initiative/tracker";
import { activeConditions, isDead } from "../src/initiative/conditions";
import { fakePlugin, t } from "./helpers";
const plugin = fakePlugin();
const tr = new InitiativeTracker(plugin);
// Deshacer / rehacer altas
const group = [tr.add({ name: "Goblin 1", initiative: 10, isPlayer: true }), tr.add({ name: "Goblin 2", initiative: 9, isPlayer: true }), tr.add({ name: "Goblin 3", initiative: 8, isPlayer: true })];
tr.recordAdded(group);
const solo = tr.add({ name: "Ana", initiative: 20, isPlayer: true }); tr.recordAdded([solo]);
t("se puede deshacer", tr.canUndoAdd, true);
t("deshacer quita solo el último grupo", tr.undoAdd().map((c) => c.name), ["Ana"]);
t("deshacer el grupo de 3 a la vez", tr.undoAdd().map((c) => c.name), ["Goblin 1", "Goblin 2", "Goblin 3"]);
t("quedan 0", plugin.settings.combat.combatants.length, 0);
t("rehacer devuelve el grupo con los mismos datos", tr.redoAdd().map((c) => [c.name, c.initiative, c.isPlayer]), [["Goblin 1", 10, true], ["Goblin 2", 9, true], ["Goblin 3", 8, true]]);
t("todavía se puede rehacer Ana", tr.canRedoAdd, true);
tr.recordAdded([tr.add({ name: "Orco", initiative: 5 })]);
t("una alta nueva descarta el rehacer", tr.canRedoAdd, false);
// Muerto automático
t("enemigo a 0 → muerto", isDead({ isPlayer: false, hp: 0, maxHp: 10 }), true);
t("enemigo a 1 → vivo", isDead({ isPlayer: false, hp: 1, maxHp: 10 }), false);
t("PJ a -44 de 45 → vivo", isDead({ isPlayer: true, hp: -44, maxHp: 45 }), false);
t("PJ a -45 de 45 → muerto", isDead({ isPlayer: true, hp: -45, maxHp: 45 }), true);
t("PJ sin máximo → nunca", isDead({ isPlayer: true, hp: -99, maxHp: null }), false);
const ids = activeConditions([], plugin.settings, { dead: true, bloodied: true }).map((a) => a.info.id + (a.auto ? "@" : ""));
t("Muerto y Ensangrentado automáticas", ids, ["dead@", "bloodied@"]);
