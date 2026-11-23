import en from "../src/i18n/locales/en.json";
import es from "../src/i18n/locales/es.json";
import { ConditionCatalog, CombatantState, activeConditions, allConditions, conditionById, BUILTIN_CONDITIONS, hpTriggerHolds, concentrationDC } from "../src/initiative/conditions";
import { InitiativeTracker } from "../src/initiative/tracker";
import type { ConditionEntry } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";
const cat: ConditionCatalog = { customConditions: [], conditionOverrides: {} };
const ids = (e: ConditionEntry[], c: ConditionCatalog = cat, who?: CombatantState) => activeConditions(e, c, who).map((a) => `${a.info.id}${a.auto ? "@" : a.explicit ? "" : "*"}${a.level ? ":" + a.level : ""}`);

t("18 condiciones (con Muerto)", BUILTIN_CONDITIONS.length, 18);
// Los textos están en los archivos de idioma: nombre y texto de cada apartado, en los dos.
const filled = (key: string) => [en, es].every((l) => typeof (l as Record<string, string>)[key] === "string" && (l as Record<string, string>)[key] !== "");
t("textos es/en completos", BUILTIN_CONDITIONS.every((b) => filled(b.name) && b.sections.every((s) => filled(s.text))), true);
const bloodiedTrigger = conditionById("bloodied", cat)!.rules.hpTriggers![0];
const bloodied = (hp: number | null, maxHp: number | null) => hpTriggerHolds(bloodiedTrigger, { isPlayer: false, hp, maxHp });
t("ensangrentado: mitad o menos", [bloodied(10, 20), bloodied(11, 20), bloodied(null, 20), bloodied(5, null)], [true, false, false, false]);
t("ensangrentado automático", ids([], cat, { isPlayer: false, hp: 10, maxHp: 20 }), ["bloodied@"]);
t("ensangrentado manual no se duplica", ids([{ id: "bloodied" }], cat, { isPlayer: false, hp: 10, maxHp: 20 }), ["bloodied"]);
t("CD concentración", [concentrationDC(5), concentrationDC(25), concentrationDC(100)], [10, 12, 30]);

// Personalizadas: aplican otras en cadena y acumulativas
const cat2: ConditionCatalog = { conditionOverrides: {}, customConditions: [
  { id: "custom-a", name: "Maldición", description: "", icon: "", implies: ["custom-b"], maxLevel: 3 },
  { id: "custom-b", name: "Petrificación lenta", description: "", icon: "", implies: ["paralyzed", "custom-a"] },
] };
t("cadena: personalizada → personalizada → Paralizado → Incapacitado (y sin bucle)", ids([{ id: "custom-a", level: 2 }], cat2), ["custom-a:2", "custom-b*", "paralyzed*", "incapacitated*"]);
t("nivel limitado al máximo", ids([{ id: "custom-a", level: 9 }], cat2)[0], "custom-a:3");
t("se aplica a sí misma: ignorado", conditionById("custom-a", { conditionOverrides: {}, customConditions: [{ id: "custom-a", name: "X", description: "", icon: "", implies: ["custom-a"] }] })!.implies, []);

// Cambios de icono/color a integradas
const cat3: ConditionCatalog = { customConditions: [], conditionOverrides: { poisoned: { icon: "skull", color: "#00ff00" }, blinded: { color: null } } };
t("override icono y color", [conditionById("poisoned", cat3)!.icon, conditionById("poisoned", cat3)!.color], ["skull", "#00ff00"]);
t("override color nativo", conditionById("blinded", cat3)!.color, undefined);
t("sin override: original", conditionById("charmed", cat3)!.color, "#e64980");
t("lista usa overrides", allConditions(cat3).find((x) => x.id === "poisoned")!.icon, "skull");

// Tracker: concentración
clearNotices();
const plugin = fakePlugin();
const tr = new InitiativeTracker(plugin);
const c = tr.add({ name: "Mago", initiative: 10, hp: 30, maxHp: 30 });
tr.addCondition(c.id, "concentration");
tr.update(c.id, { hp: 22 });
t("aviso de tirada al recibir 8 de daño (CD 10)", notices().some((n: string) => n.includes("CD 10")), true);
t("texto del aviso de tirada", notices().includes("Mago recibe 8 de daño: tirada de salvación de Constitución CD 10 para mantener Concentración."), true);
tr.update(c.id, { hp: 0 });
t("a 0 PG pierde la concentración", c.conditions.map((e) => e.id), []);
tr.update(c.id, { hp: 30 });
tr.addCondition(c.id, "concentration");
tr.addCondition(c.id, "stunned");
t("al quedar Incapacitado (por Aturdido) pierde la concentración", c.conditions.map((e) => e.id), ["stunned"]);
t("aviso de pérdida", notices().filter((n: string) => n.includes("pierde Concentración")).length, 2);
t("motivos de la pérdida", notices().filter((n: string) => n.includes("pierde Concentración")), ["Mago pierde Concentración (0 PG).", "Mago pierde Concentración (Incapacitado)."]);
tr.removeCondition(c.id, "stunned");
tr.addCondition(c.id, "unconscious");
tr.removeCondition(c.id, "unconscious");
t("inconsciente → sigue derribado", c.conditions.map((e) => e.id), ["prone"]);
