import { ConditionCatalog, activeConditions, allConditions, conditionById, BUILTIN_CONDITIONS, REMAINS_AFTER, isBloodied, concentrationDC } from "../src/initiative/conditions";
import { InitiativeTracker } from "../src/initiative/tracker";
import type { ConditionEntry } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";
const cat: ConditionCatalog = { customConditions: [], conditionOverrides: {} };
const ids = (e: ConditionEntry[], c: ConditionCatalog = cat, o: { bloodied?: boolean; dead?: boolean } = {}) => activeConditions(e, c, o).map((a) => `${a.info.id}${a.auto ? "@" : a.explicit ? "" : "*"}${a.level ? ":" + a.level : ""}`);

t("18 condiciones (con Muerto)", BUILTIN_CONDITIONS.length, 18);
t("textos es/en completos", BUILTIN_CONDITIONS.every((b) => b.name.es && b.name.en && b.sections.every((s) => s.text.es && s.text.en)), true);
t("ensangrentado: mitad o menos", [isBloodied(10, 20), isBloodied(11, 20), isBloodied(null, 20), isBloodied(5, null)], [true, false, false, false]);
t("ensangrentado automático", ids([], cat, { bloodied: true }), ["bloodied@"]);
t("ensangrentado manual no se duplica", ids([{ id: "bloodied" }], cat, { bloodied: true }), ["bloodied"]);
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
tr.update(c.id, { hp: 0 });
t("a 0 PG pierde la concentración", c.conditions.map((e) => e.id), []);
tr.update(c.id, { hp: 30 });
tr.addCondition(c.id, "concentration");
tr.addCondition(c.id, "stunned");
t("al quedar Incapacitado (por Aturdido) pierde la concentración", c.conditions.map((e) => e.id), ["stunned"]);
t("aviso de pérdida", notices().filter((n: string) => n.includes("pierde la Concentración")).length, 2);
tr.removeCondition(c.id, "stunned");
tr.addCondition(c.id, "unconscious");
tr.removeCondition(c.id, "unconscious", { remains: REMAINS_AFTER["unconscious"] });
t("inconsciente → sigue derribado", c.conditions.map((e) => e.id), ["prone"]);
