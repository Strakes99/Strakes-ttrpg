// Motor de automatismos de las condiciones (ConditionRules), igual para integradas y personalizadas.
import { ConditionCatalog, CombatantState, activeConditions, allConditions, autoCause, builtinRules, BUILTIN_CONDITIONS, combatantConditions, conditionById, defeatingIds, hpTriggerText } from "../src/initiative/conditions";
import { InitiativeTracker } from "../src/initiative/tracker";
import type { Combatant, ConditionEntry, CustomCondition } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";

const custom = (id: string, name: string, extra: Partial<CustomCondition> = {}): CustomCondition => ({ id, name, description: "", icon: "", ...extra });
const catalog = (customConditions: CustomCondition[], conditionOverrides: ConditionCatalog["conditionOverrides"] = {}): ConditionCatalog => ({ customConditions, conditionOverrides });
const ids = (e: ConditionEntry[], c: ConditionCatalog, who?: CombatantState) => activeConditions(e, c, who).map((a) => `${a.info.id}${a.auto ? "@" : a.explicit ? "" : "*"}`);
const autoIds = (e: ConditionEntry[], c: ConditionCatalog, who: CombatantState) => activeConditions(e, c, who).filter((a) => a.auto).map((a) => a.info.id);
/** Tracker con un catálogo propio. */
function trackerWith(customConditions: CustomCondition[], conditionOverrides: ConditionCatalog["conditionOverrides"] = {}): InitiativeTracker {
	const plugin = fakePlugin();
	plugin.settings.customConditions = customConditions;
	plugin.settings.conditionOverrides = conditionOverrides;
	return new InitiativeTracker(plugin);
}
const stored = (c: Combatant) => c.conditions.map((e) => e.id);

// ---------- Umbral de PG en una personalizada (25 %, solo enemigos) ----------
const wounded = custom("custom-wounded", "Malherido", { rules: { hpTriggers: [{ threshold: "percent", percent: 25, who: "enemies" }] } });
const catW = catalog([wounded]);
t("texto del umbral al 25 %", hpTriggerText({ threshold: "percent", percent: 25, who: "enemies" }), "PG al 25 % o menos");
t("enemigo al 25 %: se aplica", autoIds([], catW, { isPlayer: false, hp: 5, maxHp: 20 }).includes("custom-wounded"), true);
t("enemigo por encima del 25 %: no", autoIds([], catW, { isPlayer: false, hp: 6, maxHp: 20 }).includes("custom-wounded"), false);
t("PJ al 25 %: no (solo enemigos)", autoIds([], catW, { isPlayer: true, hp: 5, maxHp: 20 }).includes("custom-wounded"), false);
t("sin PG máximos: no", autoIds([], catW, { isPlayer: false, hp: 0, maxHp: null }).includes("custom-wounded"), false);
const w = activeConditions([], catW, { isPlayer: false, hp: 5, maxHp: 20 }).find((a) => a.info.id === "custom-wounded");
t("motivo y fin de la personalizada", [w?.auto, w?.explicit, w?.reason, w?.endsWhen], [true, false, "PG al 25 % o menos", "cuando cambian los PG"]);
t("puesta a mano: no se duplica", ids([{ id: "custom-wounded" }], catW, { isPlayer: false, hp: 5, maxHp: 20 }).filter((x) => x.startsWith("custom-wounded")), ["custom-wounded"]);
t("sin estado del combatiente: no hay automáticas", ids([], catW), []);

// ---------- Umbral de nivel en una personalizada acumulativa ----------
const venom = custom("custom-venom", "Veneno", { maxLevel: 5 });
const collapse = custom("custom-collapse", "Colapso", { implies: ["prone"], rules: { levelTriggers: [{ conditionId: "custom-venom", minLevel: 3 }] } });
const catV = catalog([venom, collapse]);
const healthy: CombatantState = { isPlayer: true, hp: 20, maxHp: 20 };
t("Veneno 2: sin Colapso", ids([{ id: "custom-venom", level: 2 }], catV, healthy), ["custom-venom"]);
t("Veneno 3: Colapso automático (y lo que aplica)", ids([{ id: "custom-venom", level: 3 }], catV, healthy), ["custom-venom", "custom-collapse@", "prone*"]);
t("motivo del umbral de nivel", autoCause(conditionById("custom-collapse", catV)!, [{ id: "custom-venom", level: 4 }], healthy, catV), { reason: "Veneno 3", endsWhen: "al bajar Veneno" });
t("una condición que no existe no dispara nada", autoCause({ ...conditionById("custom-collapse", catV)!, rules: { levelTriggers: [{ conditionId: "nope", minLevel: 1 }] } }, [{ id: "nope", level: 9 }], healthy, catV), null);
const trV = trackerWith([venom, collapse]);
const v = trV.add({ name: "Explorador", initiative: 10, hp: 20, maxHp: 20, isPlayer: true });
for (let i = 0; i < 3; i++) trV.addCondition(v.id, "custom-venom", 5);
t("tracker: tres niveles de Veneno → Colapso", combatantConditions(v, catV).some((a) => a.auto && a.info.id === "custom-collapse"), true);
trV.removeCondition(v.id, "custom-venom", { oneLevel: true });
t("tracker: bajar a Veneno 2 quita Colapso", [v.conditions, combatantConditions(v, catV).some((a) => a.info.id === "custom-collapse")], [[{ id: "custom-venom", level: 2 }], false]);

// ---------- «Al terminar, deja» al quitarla a mano ----------
const daze = custom("custom-daze", "Mareo", { maxLevel: 3, rules: { leaves: ["prone", "custom-venom"] } });
const trL = trackerWith([daze, venom]);
const l = trL.add({ name: "Guardia", initiative: 5, hp: 10, maxHp: 10 });
trL.addCondition(l.id, "custom-daze", 3);
trL.addCondition(l.id, "custom-daze", 3);
trL.removeCondition(l.id, "custom-daze", { oneLevel: true });
t("bajar un nivel no deja nada", l.conditions, [{ id: "custom-daze", level: 1 }]);
trL.removeCondition(l.id, "custom-daze", { oneLevel: true });
t("quitarla del todo deja sus condiciones (acumulativas a nivel 1)", l.conditions, [{ id: "prone" }, { id: "custom-venom", level: 1 }]);
trL.addCondition(l.id, "custom-daze", 3);
trL.removeCondition(l.id, "custom-daze");
t("no duplica las que ya tiene", stored(l), ["prone", "custom-venom"]);

// ---------- Termina sola: con otra condición y a 0 PG ----------
clearNotices();
const trance = custom("custom-trance", "Trance", { rules: { endsWith: ["frightened", "incapacitated"], endsAtZeroHp: true, leaves: ["custom-daze"] } });
const trE = trackerWith([trance, daze]);
const e = trE.add({ name: "Druida", initiative: 12, hp: 20, maxHp: 20, isPlayer: true });
trE.addCondition(e.id, "custom-trance");
trE.addCondition(e.id, "frightened");
t("termina al aparecer una de sus condiciones (y deja las suyas)", stored(e), ["frightened", "custom-daze"]);
t("aviso de fin por condición", notices(), ["Druida pierde Trance (Asustado)."]);
trE.removeCondition(e.id, "frightened");
trE.removeCondition(e.id, "custom-daze");
trE.addCondition(e.id, "custom-trance");
trE.addCondition(e.id, "paralyzed");
t("también si la aplica otra (Paralizado → Incapacitado)", stored(e).includes("custom-trance"), false);
trE.removeCondition(e.id, "paralyzed");
trE.addCondition(e.id, "custom-trance");
clearNotices();
trE.damage(e.id, 25);
t("termina a 0 PG o menos", stored(e).includes("custom-trance"), false);
t("aviso de fin a 0 PG", notices().includes("Druida pierde Trance (0 PG)."), true);
trE.heal(e.id, 30);
trE.addCondition(e.id, "custom-trance");
trE.damage(e.id, 5);
t("con PG por encima de 0, daño sin condiciones de fin: sigue", stored(e).includes("custom-trance"), true);

// ---------- Tirada de salvación al recibir daño, con otra característica ----------
clearNotices();
const bond = custom("custom-bond", "Vínculo", { rules: { damageSave: { ability: "Sabiduría" }, endsAtZeroHp: true } });
const trS = trackerWith([bond]);
const s = trS.add({ name: "Paladín", initiative: 11, hp: 40, maxHp: 40 });
trS.addCondition(s.id, "custom-bond");
trS.damage(s.id, 30);
t("aviso con la característica propia y la CD de Concentración", notices(), ["Paladín recibe 30 de daño: tirada de salvación de Sabiduría CD 15 para mantener Vínculo."]);
clearNotices();
trS.update(s.id, { hp: 4 });
t("bajar los PG a mano también avisa (6 → CD 10)", notices(), ["Paladín recibe 6 de daño: tirada de salvación de Sabiduría CD 10 para mantener Vínculo."]);
clearNotices();
trS.damage(s.id, 10);
t("si cae a 0 y termina a 0 PG, no pide tirada", notices(), ["Paladín pierde Vínculo (0 PG)."]);
t("Concentración integrada: Constitución (en el idioma actual)", builtinRules(BUILTIN_CONDITIONS.find((b) => b.id === "concentration")!).damageSave, { ability: "Constitución" });

// ---------- Derrota: el enemigo se tacha y pierde el turno ----------
const yielded = custom("custom-yield", "Rendido", { rules: { defeats: true } });
const trD = trackerWith([yielded]);
const hero = trD.add({ name: "Héroe", initiative: 20, hp: 30, maxHp: 30, isPlayer: true });
const bandit = trD.add({ name: "Bandido", initiative: 15, hp: 11, maxHp: 11 });
const ally = trD.add({ name: "Escudero", initiative: 10, hp: 9, maxHp: 9, isPlayer: true });
trD.addCondition(bandit.id, "custom-yield");
trD.addCondition(ally.id, "custom-yield");
trD.setCurrent(hero.id);
trD.next();
t("enemigo con una condición que derrota: se salta su turno", trD.current?.name, "Escudero");
trD.next();
t("un PJ con esa condición no se salta", trD.current?.name, "Héroe");
t("ids que derrotan: Muerto y la personalizada", defeatingIds(catalog([yielded])).sort(), ["custom-yield", "dead"]);

// ---------- Avisos de las automáticas («avisar») ----------
clearNotices();
const shaken = custom("custom-shaken", "Tembloroso", { rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "enemies" }], announce: true, leaves: ["frightened"] } });
const quiet = custom("custom-quiet", "Herido", { rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "enemies" }] } });
const trA = trackerWith([shaken, quiet]);
const a = trA.add({ name: "Ogro", initiative: 8, hp: 40, maxHp: 40 });
trA.damage(a.id, 25);
t("se aplica sola: aviso con el motivo (las demás no avisan)", notices(), ["Ogro: Tembloroso (PG a la mitad o menos)."]);
clearNotices();
trA.heal(a.id, 20);
t("termina sola: aviso con lo que deja", [notices(), stored(a)], [["Ogro: termina Tembloroso (sigue Asustado)."], ["frightened"]]);
clearNotices();
const plain = custom("custom-plain", "Aturdimiento leve", { rules: { hpTriggers: [{ threshold: "zero", who: "all" }], announce: true } });
const trP = trackerWith([plain]);
const p = trP.add({ name: "Lobo", initiative: 3, hp: 0, maxHp: 10 });
t("aviso al entrar ya con ella", notices(), ["Lobo: Aturdimiento leve (0 PG o menos)."]);
clearNotices();
trP.heal(p.id, 1);
t("aviso de fin sin nada que deje", notices(), ["Lobo: termina Aturdimiento leve."]);

// ---------- Integradas ocultas ----------
const hidden = catalog([], { incapacitated: { hidden: true }, bloodied: { hidden: true }, exhaustion: { hidden: true } });
t("oculta: conditionById la ignora", conditionById("incapacitated", hidden), null);
t("oculta: visible con includeHidden", conditionById("incapacitated", hidden, true)?.hidden, true);
t("oculta: no está en la lista", allConditions(hidden).some((x) => x.id === "incapacitated"), false);
t("oculta: sí con includeHidden", allConditions(hidden, { includeHidden: true }).filter((x) => x.hidden).map((x) => x.id).sort(), ["bloodied", "exhaustion", "incapacitated"]);
t("oculta: ninguna otra la aplica (Paralizado sin Incapacitado)", ids([{ id: "paralyzed" }], hidden), ["paralyzed"]);
t("oculta: guardada a mano, se ignora", ids([{ id: "incapacitated" }], hidden), []);
t("oculta: no se aplica sola (Ensangrentado)", autoIds([], hidden, { isPlayer: false, hp: 1, maxHp: 10 }), []);
t("oculta como origen de nivel: Agotamiento 6 no mata", autoIds([{ id: "exhaustion", level: 6 }], hidden, healthy), []);
const trH = trackerWith([], { unconscious: { hidden: true }, incapacitated: { hidden: true } });
const h = trH.add({ name: "Bárbara", initiative: 9, hp: 10, maxHp: 10, isPlayer: true });
trH.addCondition(h.id, "concentration");
trH.addCondition(h.id, "stunned");
t("tracker: Incapacitado oculta no termina la Concentración", stored(h), ["concentration", "stunned"]);
trH.removeCondition(h.id, "concentration");
trH.damage(h.id, 10);
trH.heal(h.id, 5);
t("tracker: Inconsciente oculta no se aplica ni deja Derribado", [combatantConditions(h, catalog([], { unconscious: { hidden: true }, incapacitated: { hidden: true } })).some((x) => x.info.id === "unconscious"), stored(h)], [false, ["stunned"]]);
t("Muerto oculto: no derrota", defeatingIds(catalog([], { dead: { hidden: true } })), []);

// ---------- Automatismos cambiados en una integrada ----------
const at30 = catalog([], { bloodied: { rules: { hpTriggers: [{ threshold: "percent", percent: 30, who: "all" }] } } });
t("Ensangrentado al 30 %: 6 de 20 sí", autoIds([], at30, { isPlayer: true, hp: 6, maxHp: 20 }).includes("bloodied"), true);
t("Ensangrentado al 30 %: 7 de 20 no", autoIds([], at30, { isPlayer: true, hp: 7, maxHp: 20 }).includes("bloodied"), false);
t("motivo con el porcentaje nuevo", activeConditions([], at30, { isPlayer: false, hp: 6, maxHp: 20 }).find((x) => x.info.id === "bloodied")?.reason, "PG al 30 % o menos");
t("los automatismos originales no cambian", builtinRules(BUILTIN_CONDITIONS.find((b) => b.id === "bloodied")!), { hpTriggers: [{ threshold: "percent", percent: 50, who: "all" }] });
const noDeath = catalog([], { dead: { rules: { hpTriggers: [{ threshold: "zero", who: "enemies" }] } } });
t("Muerto sin umbral de nivel ni derrota: Agotamiento 6 no mata", autoIds([{ id: "exhaustion", level: 6 }], noDeath, healthy), []);
t("…y un enemigo a 0 PG muere pero no se tacha", [autoIds([], noDeath, { isPlayer: false, hp: 0, maxHp: 10 }).includes("dead"), defeatingIds(noDeath)], [true, []]);

// ---------- Lo que deja una condición al terminar puede acabar con otra («termina si tiene…») ----------
const focus = custom("custom-focus", "Foco", { rules: { endsWith: ["frightened"] } });
const dream = custom("custom-dream", "Sueño", { rules: { leaves: ["frightened"] } });
const trF = trackerWith([focus, dream]);
const f = trF.add({ name: "Vidente", initiative: 11, hp: 12, maxHp: 12 });
trF.addCondition(f.id, "custom-focus");
trF.addCondition(f.id, "custom-dream");
trF.removeCondition(f.id, "custom-dream");
t("quitar Sueño deja Asustado, que acaba con Foco", stored(f), ["frightened"]);
// Lo mismo cuando lo dejado viene de una automática que termina al curarse.
const lull = custom("custom-lull", "Aturdimiento leve", { rules: { hpTriggers: [{ threshold: "zero", who: "all" }], leaves: ["frightened"] } });
const trLull = trackerWith([focus, lull]);
const guard = trLull.add({ name: "Guardia", initiative: 7, hp: 0, maxHp: 10 });
trLull.addCondition(guard.id, "custom-focus");
trLull.heal(guard.id, 5);
t("al curarse deja Asustado, que acaba con Foco", stored(guard), ["frightened"]);
