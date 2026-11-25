import { T, TC, TranslationKey } from "../i18n";
import { ConditionEntry, ConditionOverride, ConditionRules, CustomCondition, HpTrigger } from "../types";

/** Datos del usuario que afectan al catálogo: condiciones propias y cambios a las integradas. */
export interface ConditionCatalog {
	customConditions: CustomCondition[];
	conditionOverrides: Record<string, ConditionOverride>;
}

/** Enlaces de la atribución del SRD 5.2 (licencia CC-BY-4.0), que se muestra en los ajustes. */
export const SRD_URL = "https://www.dndbeyond.com/srd";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/legalcode";

const DEAD_ID = "dead";
const INCAPACITATED_ID = "incapacitated";
const EXHAUSTION_ID = "exhaustion";
const PRONE_ID = "prone";
/** Nivel de Agotamiento con el que la criatura muere (SRD 5.2). */
const EXHAUSTION_DEATH_LEVEL = 6;

/** Apartado de la descripción de una integrada (título vacío = sin encabezado). */
export interface ConditionSection {
	/** Clave del título (texto vacío = sin encabezado) y del texto, en los archivos de idioma. */
	title: TranslationKey;
	text: TranslationKey;
}

/** Automatismos de una integrada: como `ConditionRules`, con la característica de la salvación traducible. */
export type BuiltinRules = Omit<ConditionRules, "damageSave"> & { damageSave?: { ability: TranslationKey } };

/**
 * Condiciones de las reglas básicas (SRD 5.2, licencia CC-BY-4.0).
 * Cada una tiene un icono de Lucide y un color; `implies` son las condiciones
 * que aplica automáticamente (p. ej. Paralizado → Incapacitado).
 */
export interface BuiltinCondition {
	id: string;
	/** Clave del nombre en los archivos de idioma (`srd.condition.<id>.name`). */
	name: TranslationKey;
	icon: string;
	color: string;
	implies?: string[];
	/** Niveles acumulables (Agotamiento: 6). */
	maxLevel?: number;
	/** Apartados de la descripción; se muestran como encabezados `##` en Markdown. */
	sections: ConditionSection[];
	rules?: BuiltinRules;
}

/**
 * Una condición lista para usar, sea integrada o personalizada: las dos funcionan igual
 * (mismo editor, mismos automatismos). Ver `conditionById` y `allConditions`.
 */
export interface ConditionInfo {
	id: string;
	name: string;
	icon: string;
	/** Color del icono; undefined = color nativo (SVG). */
	color?: string;
	implies: string[];
	maxLevel?: number;
	/** Descripción en Markdown (negrita, cursiva, encabezados…). */
	description: string;
	rules: ConditionRules;
	custom: boolean;
	/** Integrada oculta por el usuario (solo aparece al pedir `includeHidden`). */
	hidden: boolean;
}

/**
 * Apartado `n` (desde 1) de la descripción de una integrada. Sus textos están en los archivos de idioma
 * (`srd.condition.<id>.<n>.title` y `.text`), como el resto de la interfaz.
 */
const sec = (id: string, n: number): ConditionSection => ({
	title: `srd.condition.${id}.${n}.title` as TranslationKey,
	text: `srd.condition.${id}.${n}.text` as TranslationKey,
});

export const BUILTIN_CONDITIONS: BuiltinCondition[] = [
	{
		id: "blinded",
		name: "srd.condition.blinded.name",
		icon: "eye-off",
		color: "#868e96",
		sections: [
			sec("blinded", 1),
			sec("blinded", 2),
		],
	},
	{
		id: "bloodied",
		name: "srd.condition.bloodied.name",
		icon: "droplet",
		color: "#c92a2a",
		sections: [
			sec("bloodied", 1),
		],
		rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "all" }] },
	},
	{
		id: "dead",
		name: "srd.condition.dead.name",
		icon: "skull",
		color: "#dee2e6",
		sections: [
			sec("dead", 1),
			sec("dead", 2),
		],
		rules: {
			hpTriggers: [
				{ threshold: "zero", who: "enemies" },
				{ threshold: "negative-max", who: "allies" },
			],
			levelTriggers: [{ conditionId: EXHAUSTION_ID, minLevel: EXHAUSTION_DEATH_LEVEL }],
			defeats: true,
		},
	},
	{
		id: "concentration",
		name: "srd.condition.concentration.name",
		icon: "brain",
		color: "#4dabf7",
		sections: [
			sec("concentration", 1),
			sec("concentration", 2),
			sec("concentration", 3),
			sec("concentration", 4),
		],
		rules: {
			concentration: true,
			endsWith: [INCAPACITATED_ID, DEAD_ID],
			endsAtZeroHp: true,
			damageSave: { ability: "srd.condition.concentration.saveAbility" },
		},
	},
	{
		id: "charmed",
		name: "srd.condition.charmed.name",
		icon: "heart",
		color: "#e64980",
		sections: [
			sec("charmed", 1),
			sec("charmed", 2),
		],
	},
	{
		id: "deafened",
		name: "srd.condition.deafened.name",
		icon: "ear-off",
		color: "#868e96",
		sections: [
			sec("deafened", 1),
		],
	},
	{
		id: "exhaustion",
		name: "srd.condition.exhaustion.name",
		icon: "battery-low",
		color: "#f08c00",
		maxLevel: 6,
		sections: [
			sec("exhaustion", 1),
			sec("exhaustion", 2),
			sec("exhaustion", 3),
			sec("exhaustion", 4),
		],
	},
	{
		id: "frightened",
		name: "srd.condition.frightened.name",
		icon: "ghost",
		color: "#9c36b5",
		sections: [
			sec("frightened", 1),
			sec("frightened", 2),
		],
	},
	{
		id: "grappled",
		name: "srd.condition.grappled.name",
		icon: "grab",
		color: "#a9714b",
		sections: [
			sec("grappled", 1),
			sec("grappled", 2),
			sec("grappled", 3),
		],
	},
	{
		id: "incapacitated",
		name: "srd.condition.incapacitated.name",
		icon: "ban",
		color: "#fa5252",
		sections: [
			sec("incapacitated", 1),
			sec("incapacitated", 2),
			sec("incapacitated", 3),
			sec("incapacitated", 4),
		],
	},
	{
		id: "invisible",
		name: "srd.condition.invisible.name",
		icon: "venetian-mask",
		color: "#74c0fc",
		sections: [
			sec("invisible", 1),
			sec("invisible", 2),
			sec("invisible", 3),
		],
	},
	{
		id: "paralyzed",
		name: "srd.condition.paralyzed.name",
		icon: "zap",
		color: "#fcc419",
		implies: ["incapacitated"],
		sections: [
			sec("paralyzed", 1),
			sec("paralyzed", 2),
			sec("paralyzed", 3),
			sec("paralyzed", 4),
			sec("paralyzed", 5),
		],
	},
	{
		id: "petrified",
		name: "srd.condition.petrified.name",
		icon: "mountain",
		color: "#adb5bd",
		implies: ["incapacitated"],
		sections: [
			sec("petrified", 1),
			sec("petrified", 2),
			sec("petrified", 3),
			sec("petrified", 4),
			sec("petrified", 5),
			sec("petrified", 6),
			sec("petrified", 7),
		],
	},
	{
		id: "poisoned",
		name: "srd.condition.poisoned.name",
		icon: "biohazard",
		color: "#51cf66",
		sections: [
			sec("poisoned", 1),
		],
	},
	{
		id: "prone",
		name: "srd.condition.prone.name",
		icon: "arrow-down-to-line",
		color: "#ced4da",
		sections: [
			sec("prone", 1),
			sec("prone", 2),
		],
	},
	{
		id: "restrained",
		name: "srd.condition.restrained.name",
		icon: "link",
		color: "#a9714b",
		sections: [
			sec("restrained", 1),
			sec("restrained", 2),
			sec("restrained", 3),
		],
	},
	{
		id: "stunned",
		name: "srd.condition.stunned.name",
		icon: "sparkles",
		color: "#ffd43b",
		implies: ["incapacitated"],
		sections: [
			sec("stunned", 1),
			sec("stunned", 2),
			sec("stunned", 3),
		],
	},
	{
		id: "unconscious",
		name: "srd.condition.unconscious.name",
		icon: "moon",
		color: "#748ffc",
		implies: ["incapacitated", "prone"],
		sections: [
			sec("unconscious", 1),
			sec("unconscious", 2),
			sec("unconscious", 3),
			sec("unconscious", 4),
			sec("unconscious", 5),
			sec("unconscious", 6),
		],
		// Al terminar Inconsciente sigues Derribado.
		rules: { hpTriggers: [{ threshold: "zero", who: "allies" }], leaves: [PRONE_ID], announce: true },
	},
];

// ---------- Catálogo: integradas (con los cambios del usuario) y personalizadas ----------

/** Descripción de una integrada en Markdown: cada apartado con título es un encabezado `##`. */
export function builtinMarkdown(b: BuiltinCondition): string {
	return b.sections.map((x) => (TC(x.title) ? `## ${TC(x.title)}\n\n${TC(x.text)}` : TC(x.text))).join("\n\n");
}

/** Automatismos originales de una integrada, con los textos en el idioma actual. */
export function builtinRules(b: BuiltinCondition): ConditionRules {
	const r = b.rules;
	if (!r) return {};
	const { damageSave, ...rest } = r;
	return structuredClone({ ...rest, ...(damageSave ? { damageSave: { ability: TC(damageSave.ability) } } : {}) });
}

/** Condición integrada con los cambios del usuario (nombre, descripción, icono, color, automatismos…). */
export function builtinInfo(b: BuiltinCondition, o?: ConditionOverride): ConditionInfo {
	const color = o && "color" in o ? (o.color ?? undefined) : b.color;
	const maxLevel = o && "maxLevel" in o ? (o.maxLevel ?? undefined) : b.maxLevel;
	return {
		id: b.id,
		name: o?.name?.trim() || TC(b.name),
		icon: o?.icon || b.icon,
		color,
		implies: (o?.implies ?? b.implies ?? []).filter((id) => id !== b.id),
		maxLevel: maxLevel && maxLevel > 1 ? maxLevel : undefined,
		description: o?.description ?? builtinMarkdown(b),
		rules: o?.rules ?? builtinRules(b),
		custom: false,
		hidden: o?.hidden === true,
	};
}

export function customInfo(c: CustomCondition): ConditionInfo {
	return {
		id: c.id,
		name: c.name,
		icon: c.icon,
		color: c.color,
		implies: (c.implies ?? []).filter((id) => id !== c.id),
		maxLevel: c.maxLevel && c.maxLevel > 1 ? c.maxLevel : undefined,
		description: c.description,
		rules: c.rules ?? {},
		custom: true,
		hidden: false,
	};
}

/**
 * Todas las condiciones: integradas (por orden alfabético del idioma) y personalizadas.
 * Las ocultas no se incluyen salvo con `includeHidden` (solo los ajustes las muestran).
 */
export function allConditions(catalog: ConditionCatalog, opts: { includeHidden?: boolean } = {}): ConditionInfo[] {
	const builtins = BUILTIN_CONDITIONS.map((b) => builtinInfo(b, catalog.conditionOverrides[b.id])).sort((a, b) => a.name.localeCompare(b.name));
	const all = [...builtins, ...catalog.customConditions.map(customInfo)];
	return opts.includeHidden ? all : all.filter((x) => !x.hidden);
}

/** Una condición por id. Una oculta cuenta como inexistente (no se muestra ni se aplica), salvo con `includeHidden`. */
export function conditionById(id: string, catalog: ConditionCatalog, includeHidden = false): ConditionInfo | null {
	const b = BUILTIN_CONDITIONS.find((x) => x.id === id);
	const info = b ? builtinInfo(b, catalog.conditionOverrides[b.id]) : (() => {
		const c = catalog.customConditions.find((x) => x.id === id);
		return c ? customInfo(c) : null;
	})();
	return info && (includeHidden || !info.hidden) ? info : null;
}

// ---------- Automatismos ----------

/** Lo que necesitan las reglas automáticas de un combatiente. */
export interface CombatantState {
	isPlayer: boolean;
	hp: number | null;
	maxHp: number | null;
}

/** Una condición tal como se ve en un combatiente: elegida a mano, aplicada por otra o automática. */
export interface ActiveCondition {
	info: ConditionInfo;
	level?: number;
	/** Nombres de las condiciones que la aplican (vacío si se eligió a mano). */
	impliedBy: string[];
	explicit: boolean;
	/** Se aplica sola por sus reglas (PG o nivel de otra condición). */
	auto?: boolean;
	/** Solo automáticas: por qué se aplica («PG a la mitad o menos», «Agotamiento 6»…). */
	reason?: string;
	/** Solo automáticas: cuándo se quita sola («cuando cambian los PG», «al bajar Agotamiento»). */
	endsWhen?: string;
}

function appliesTo(who: HpTrigger["who"], c: CombatantState): boolean {
	return who === "all" || (who === "enemies" ? !c.isPlayer : c.isPlayer);
}

/** ¿Se cumple este umbral de PG? */
export function hpTriggerHolds(t: HpTrigger, c: CombatantState): boolean {
	if (c.hp === null || !appliesTo(t.who, c)) return false;
	switch (t.threshold) {
		case "percent":
			return c.maxHp !== null && c.maxHp > 0 && c.hp <= (c.maxHp * (t.percent ?? 50)) / 100;
		case "zero":
			return c.hp <= 0;
		case "negative-max":
			return c.maxHp !== null && c.maxHp > 0 && c.hp <= -c.maxHp;
	}
}

/** Texto del umbral para mostrarlo («PG a la mitad o menos»…). */
export function hpTriggerText(t: HpTrigger): string {
	switch (t.threshold) {
		case "percent":
			return (t.percent ?? 50) === 50 ? T("conditions.hpAtHalfOrLess") : T("conditions.hpAtOrLess", { percent: t.percent });
		case "zero":
			return T("conditions.n0HpOrLess");
		case "negative-max":
			return T("conditions.hpAtMinusItsMaximum");
	}
}

/** Nivel con el que tiene a mano una condición acumulativa (0 si no la tiene). */
function entryLevel(entries: ConditionEntry[], id: string): number {
	const e = entries.find((x) => x.id === id);
	return e ? (e.level ?? 1) : 0;
}

/**
 * Si una condición se aplica sola ahora mismo, el motivo y cuándo se quitará; null si no.
 * La condición de un umbral de nivel tiene que existir y no estar oculta.
 */
export function autoCause(info: ConditionInfo, entries: ConditionEntry[], c: CombatantState, catalog: ConditionCatalog): { reason: string; endsWhen: string } | null {
	for (const t of info.rules.hpTriggers ?? [])
		if (hpTriggerHolds(t, c)) return { reason: hpTriggerText(t), endsWhen: T("conditions.whenHpChanges") };
	for (const t of info.rules.levelTriggers ?? []) {
		const source = t.conditionId;
		const src = source !== info.id ? conditionById(source, catalog) : null;
		if (src && entryLevel(entries, source) >= t.minLevel)
			return { reason: `${src.name} ${t.minLevel}`, endsWhen: T("conditions.whenGoesDown", { name: src.name }) };
	}
	return null;
}

/**
 * Condiciones efectivas de un combatiente: las elegidas, las automáticas por sus reglas
 * (si se pasa `who`, el estado del combatiente) y las que estas aplican, en cadena (una
 * condición puede aplicar Paralizado, que aplica Incapacitado). Sin duplicados; las que no
 * existen o están ocultas se ignoran.
 */
export function activeConditions(entries: ConditionEntry[], catalog: ConditionCatalog, who?: CombatantState): ActiveCondition[] {
	const out: ActiveCondition[] = [];
	const byId = new Map<string, ActiveCondition>();
	for (const e of entries) {
		const info = conditionById(e.id, catalog);
		if (!info || byId.has(info.id)) continue;
		const a: ActiveCondition = {
			info,
			level: info.maxLevel ? Math.max(1, Math.min(info.maxLevel, e.level ?? 1)) : undefined,
			impliedBy: [],
			explicit: true,
		};
		byId.set(info.id, a);
		out.push(a);
	}
	if (who)
		for (const info of allConditions(catalog)) {
			if (byId.has(info.id)) continue;
			const cause = autoCause(info, entries, who, catalog);
			if (!cause) continue;
			const a: ActiveCondition = { info, impliedBy: [], explicit: false, auto: true, ...cause };
			byId.set(info.id, a);
			out.push(a);
		}
	// Recorre en anchura: las condiciones aplicadas pueden aplicar a su vez otras.
	for (let i = 0; i < out.length; i++) {
		const a = out[i];
		for (const imp of a.info.implies) {
			const existing = byId.get(imp);
			if (existing) {
				if (!existing.explicit && !existing.auto && !existing.impliedBy.includes(a.info.name)) existing.impliedBy.push(a.info.name);
				continue;
			}
			const info = conditionById(imp, catalog);
			if (!info) continue;
			const ia: ActiveCondition = { info, impliedBy: [a.info.name], explicit: false };
			byId.set(imp, ia);
			out.push(ia);
		}
	}
	return out;
}

/** Condiciones efectivas de un combatiente, con sus automáticas. */
export function combatantConditions(c: CombatantState & { conditions: ConditionEntry[] }, catalog: ConditionCatalog): ActiveCondition[] {
	return activeConditions(c.conditions, catalog, c);
}

/**
 * Enemigo derrotado: tiene alguna condición que «derrota» (Muerto, por PG o por
 * Agotamiento). Se tacha, su turno se salta y los jugadores solo ven esa condición. Los PJ
 * y aliados nunca cuentan como derrotados.
 */
export function isDefeatedEnemy(c: CombatantState & { conditions: ConditionEntry[] }, catalog: ConditionCatalog): boolean {
	return !c.isPlayer && combatantConditions(c, catalog).some((a) => a.info.rules.defeats);
}

/** Ids de las condiciones que derrotan (lo único que ven los jugadores de un enemigo derrotado). */
export function defeatingIds(catalog: ConditionCatalog): string[] {
	return allConditions(catalog)
		.filter((x) => x.rules.defeats)
		.map((x) => x.id);
}

/** CD de la tirada de salvación al recibir daño (la de Concentración): máx(10, mitad del daño), hasta 30. */
export function concentrationDC(damage: number): number {
	return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}
