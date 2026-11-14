// Duplicar combatientes (nombre numerado, deshacer/rehacer) y muerte por Agotamiento 6.
import { CombatantState, autoCause, combatantConditions, conditionById, isDefeatedEnemy } from "../src/initiative/conditions";
import { InitiativeTracker, nextNumberedName } from "../src/initiative/tracker";
import type { ConditionEntry } from "../src/types";
import { fakePlugin, t } from "./helpers";

// Siguiente nombre libre.
const goblins = ["Goblin 1", "Goblin 2", "Goblin 3", "Goblin 4", "Goblin 5", "Goblin 6"];
t("Goblin 4 con Goblin 1…6 → Goblin 7", nextNumberedName("Goblin 4", goblins), "Goblin 7");
t("con huecos, el mayor + 1", nextNumberedName("Goblin 1", ["Goblin 1", "Goblin 5"]), "Goblin 6");
t("sin número: el original cuenta como 1", nextNumberedName("Strahd", ["Strahd"]), "Strahd 2");
t("sin número, con un 2 ya usado", nextNumberedName("Strahd", ["Strahd", "Strahd 2"]), "Strahd 3");
t("sin distinguir mayúsculas", nextNumberedName("orco 2", ["Orco 1", "ORCO 2", "Orco 3"]), "orco 4");
t("otras bases no cuentan", nextNumberedName("Lobo 1", ["Lobo 1", "Lobo gigante 9"]), "Lobo 2");
t("nombre que acaba en número sin espacio", nextNumberedName("T-Rex2", ["T-Rex2"]), "T-Rex2 2");

// Duplicar en el tracker: copia los datos, y se deshace y rehace como un alta.
const plugin = fakePlugin();
const tr = new InitiativeTracker(plugin);
const names = () => tr.state.combatants.map((c) => c.name).sort();
const g1 = tr.add({ name: "Goblin 1", initiative: 12, hp: 7, maxHp: 7, ac: 15 });
tr.add({ name: "Goblin 2", initiative: 10, hp: 7, maxHp: 7, ac: 15 });
tr.addCondition(g1.id, "poisoned");
const copy = tr.duplicate(g1.id);
t("la copia se llama Goblin 3", copy?.name, "Goblin 3");
t("copia PG, CA e iniciativa, pero no las condiciones", copy && [copy.hp, copy.maxHp, copy.ac, copy.initiative, copy.conditions.map((e) => e.id)], [7, 7, 15, 12, []]);
t("la copia tiene otro id", copy !== null && copy.id !== g1.id, true);
t("se puede deshacer", tr.canUndoAdd, true);
tr.undoAdd();
t("deshacer quita la copia", names(), ["Goblin 1", "Goblin 2"]);
tr.redoAdd();
t("rehacer la vuelve a poner", names(), ["Goblin 1", "Goblin 2", "Goblin 3"]);
t("duplicar un id que no existe", tr.duplicate("nada"), null);

// Muerte por Agotamiento 6.
type State = CombatantState & { conditions: ConditionEntry[] };
const cat = plugin.settings;
const deadOf = (c: State) => combatantConditions(c, cat).find((a) => a.info.id === "dead");
const isDead = (c: State) => deadOf(c) !== undefined;
const exhausted = (level: number): State => ({ isPlayer: true, hp: 20, maxHp: 20, conditions: [{ id: "exhaustion", level }] });
t("Agotamiento 5: vivo", isDead(exhausted(5)), false);
t("Agotamiento 6: muerto", isDead(exhausted(6)), true);
t("por Agotamiento, no por PG", deadOf(exhausted(6))?.reason, "Agotamiento 6");
t("sin condiciones: solo cuentan los PG", isDead({ isPlayer: false, hp: 0, maxHp: 10, conditions: [] }), true);
const dead = deadOf(exhausted(6));
t("Muerto aparece como automático por Agotamiento", [dead?.auto, dead?.reason], [true, "Agotamiento 6"]);
const deadInfo = conditionById("dead", cat)!;
t("motivo que se muestra", autoCause(deadInfo, exhausted(6).conditions, exhausted(6), cat)?.reason, "Agotamiento 6");
t("motivo por PG (enemigo)", autoCause(deadInfo, [], { isPlayer: false, hp: 0, maxHp: 10 }, cat)?.reason, "0 PG o menos");
t("motivo por PG (PJ)", autoCause(deadInfo, [], { isPlayer: true, hp: -10, maxHp: 10 }, cat)?.reason, "PG en su máximo negativo o menos");

// En el tracker: subir el Agotamiento hasta 6.
const pj = tr.add({ name: "Pícara", initiative: 14, hp: 18, maxHp: 18, isPlayer: true });
for (let i = 0; i < 6; i++) tr.addCondition(pj.id, "exhaustion", 6);
const pjNow = tr.state.combatants.find((c) => c.id === pj.id);
t("tras 6 niveles de Agotamiento, muere", pjNow ? isDead(pjNow) : false, true);

// Un enemigo muerto (también por Agotamiento 6) se tacha y pierde el turno; un PJ no.
t("enemigo con Agotamiento 6: derrotado", isDefeatedEnemy({ ...exhausted(6), isPlayer: false }, cat), true);
t("PJ con Agotamiento 6: no cuenta como derrotado", isDefeatedEnemy(exhausted(6), cat), false);
const tr2 = new InitiativeTracker(fakePlugin());
const lich = tr2.add({ name: "Liche", initiative: 18, hp: 90, maxHp: 90 });
const hero = tr2.add({ name: "Héroe", initiative: 15, hp: 30, maxHp: 30, isPlayer: true });
const orc = tr2.add({ name: "Orco", initiative: 12, hp: 15, maxHp: 15 });
for (let i = 0; i < 6; i++) tr2.addCondition(lich.id, "exhaustion", 6);
tr2.setCurrent(orc.id);
tr2.next();
t("tras el Orco, se salta al Liche muerto por Agotamiento y pasa al Héroe", tr2.state.currentId === hero.id, true);

// Morir por Agotamiento 6 también termina la Concentración.
const tr3 = new InitiativeTracker(fakePlugin());
const mage = tr3.add({ name: "Maga", initiative: 10, hp: 20, maxHp: 20, isPlayer: true });
tr3.addCondition(mage.id, "concentration");
for (let i = 0; i < 6; i++) tr3.addCondition(mage.id, "exhaustion", 6);
t("Agotamiento 6 → Muerto → pierde la Concentración", mage.conditions.map((e) => e.id), ["exhaustion"]);
