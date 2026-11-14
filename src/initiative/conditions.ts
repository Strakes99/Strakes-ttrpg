import { Localized, T, tr } from "../i18n";
import { ConditionEntry, ConditionOverride, ConditionRules, CustomCondition, HpTrigger } from "../types";

/** Datos del usuario que afectan al catálogo: condiciones propias y cambios a las integradas. */
export interface ConditionCatalog {
	customConditions: CustomCondition[];
	conditionOverrides: Record<string, ConditionOverride>;
}

/** Enlaces de la atribución del SRD 5.2 (licencia CC-BY-4.0), que se muestra en los ajustes. */
export const SRD_URL = "https://www.dndbeyond.com/srd";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/legalcode";

export const BLOODIED_ID = "bloodied";
export const DEAD_ID = "dead";
export const CONCENTRATION_ID = "concentration";
export const INCAPACITATED_ID = "incapacitated";
export const UNCONSCIOUS_ID = "unconscious";
export const EXHAUSTION_ID = "exhaustion";
export const PRONE_ID = "prone";
/** Nivel de Agotamiento con el que la criatura muere (SRD 5.2). */
export const EXHAUSTION_DEATH_LEVEL = 6;

/**
 * Condiciones de las reglas básicas (SRD 5.2, licencia CC-BY-4.0).
 * Cada una tiene un icono de Lucide y un color; `implies` son las condiciones
 * que aplica automáticamente (p. ej. Paralizado → Incapacitado).
 */
export interface ConditionSection {
	title: Localized;
	text: Localized;
}

/** Automatismos de una integrada: como `ConditionRules`, con la característica de la salvación traducible. */
export type BuiltinRules = Omit<ConditionRules, "damageSave"> & { damageSave?: { ability: Localized } };

export interface BuiltinCondition {
	id: string;
	name: Localized;
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

const s = (titleEs: string, titleEn: string, textEs: string, textEn: string): ConditionSection => ({
	title: { es: titleEs, en: titleEn },
	text: { es: textEs, en: textEn },
});

export const BUILTIN_CONDITIONS: BuiltinCondition[] = [
	{
		id: "blinded",
		name: { es: "Cegado", en: "Blinded" },
		icon: "eye-off",
		color: "#868e96",
		sections: [
			s("No puede ver", "Can't See", "No puedes ver y fallas automáticamente cualquier prueba de característica que requiera la vista.", "You can't see and automatically fail any ability check that requires sight."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja, y tus tiradas de ataque tienen Desventaja.", "Attack rolls against you have Advantage, and your attack rolls have Disadvantage."),
		],
	},
	{
		id: "bloodied",
		name: { es: "Ensangrentado", en: "Bloodied" },
		icon: "droplet",
		color: "#c92a2a",
		sections: [
			s("", "", "Una criatura está Ensangrentada mientras le quede la mitad de sus Puntos de Golpe o menos.", "A creature is Bloodied while it has half its Hit Points or fewer remaining."),
		],
		rules: { hpTriggers: [{ threshold: "percent", percent: 50, who: "all" }] },
	},
	{
		id: "dead",
		name: { es: "Muerto", en: "Dead" },
		icon: "skull",
		color: "#dee2e6",
		sections: [
			s(
				"",
				"",
				"Una criatura muerta no tiene Puntos de Golpe y no puede recuperarlos a menos que antes sea revivida mediante magia, como los conjuros Revivir a los muertos o Revivificar. Cuando se lanza uno de esos conjuros, el espíritu sabe quién lo está lanzando y puede negarse. El espíritu de una criatura muerta ha abandonado el cuerpo y ha partido hacia los Planos Exteriores, por lo que revivirla exige hacer volver a ese espíritu.",
				"A dead creature has no Hit Points and can't regain them unless it is first revived by magic such as the Raise Dead or Revivify spell. When such a spell is cast, the spirit knows who is casting it and can refuse. The spirit of a dead creature has left the body and departed for the Outer Planes, and reviving the creature requires calling the spirit back.",
			),
			s(
				"Muerte instantánea",
				"Instant Death",
				"Si el daño te reduce a 0 PG y el daño restante es igual o superior a tus PG máximos, mueres.",
				"If damage reduces you to 0 Hit Points and the remaining damage equals or exceeds your Hit Point maximum, you die.",
			),
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
		name: { es: "Concentración", en: "Concentration" },
		icon: "brain",
		color: "#4dabf7",
		sections: [
			s(
				"",
				"",
				"Algunos conjuros y otros efectos requieren Concentración para permanecer activos, como se especifica en sus descripciones. Si el creador del efecto pierde la Concentración, el efecto termina. Si el efecto tiene una duración máxima, la descripción del efecto especifica cuánto tiempo puede el creador concentrarse en él: hasta 1 minuto, 1 hora, o alguna otra duración. El creador puede terminar la Concentración en cualquier momento (no requiere acción). Los siguientes factores rompen la Concentración.",
				"Some spells and other effects require Concentration to remain active, as specified in their descriptions. If the effect's creator loses Concentration, the effect ends. If the effect has a maximum duration, the effect's description specifies how long the creator can concentrate on it: up to 1 minute, 1 hour, or some other duration. The creator can end Concentration at any time (no action required). The following factors break Concentration.",
			),
			s("Otro efecto de Concentración", "Another Concentration Effect", "Pierdes la Concentración en un efecto en el momento en que comienzas a lanzar un conjuro que requiere Concentración o activas otro efecto que requiere Concentración.", "You lose Concentration on an effect the moment you start casting a spell that requires Concentration or activate another effect that requires Concentration."),
			s("Daño", "Damage", "Si recibes daño, debes tener éxito en una tirada de salvación de Constitución para mantener la Concentración. La CD es igual a 10 o la mitad del daño recibido (redondeando hacia abajo), el número que sea mayor, hasta una CD máxima de 30.", "If you take damage, you must succeed on a Constitution saving throw to maintain Concentration. The DC equals 10 or half the damage taken (round down), whichever number is higher, up to a maximum DC of 30."),
			s("Incapacitado o muerto", "Incapacitated or Dead", "Tu Concentración termina si tienes la condición de Incapacitado o mueres.", "Your Concentration ends if you have the Incapacitated condition or you die."),
		],
		rules: {
			endsWith: [INCAPACITATED_ID, DEAD_ID],
			endsAtZeroHp: true,
			damageSave: { ability: { es: "Constitución", en: "Constitution" } },
		},
	},
	{
		id: "charmed",
		name: { es: "Hechizado", en: "Charmed" },
		icon: "heart",
		color: "#e64980",
		sections: [
			s("No puede dañar al hechizador", "Can't Harm the Charmer", "No puedes atacar al hechizador ni elegirlo como objetivo de habilidades dañinas o efectos mágicos.", "You can't attack the charmer or target the charmer with damaging abilities or magical effects."),
			s("Ventaja social", "Social Advantage", "El hechizador tiene Ventaja en cualquier prueba de característica para interactuar contigo socialmente.", "The charmer has Advantage on any ability check to interact with you socially."),
		],
	},
	{
		id: "deafened",
		name: { es: "Ensordecido", en: "Deafened" },
		icon: "ear-off",
		color: "#868e96",
		sections: [
			s("No puede oír", "Can't Hear", "No puedes oír y fallas automáticamente cualquier prueba de característica que requiera la audición.", "You can't hear and automatically fail any ability check that requires hearing."),
		],
	},
	{
		id: "exhaustion",
		name: { es: "Agotamiento", en: "Exhaustion" },
		icon: "battery-low",
		color: "#f08c00",
		maxLevel: 6,
		sections: [
			s("Niveles de agotamiento", "Exhaustion Levels", "Esta condición es acumulativa. Cada vez que la recibes, ganas 1 nivel de Agotamiento. Mueres si tu nivel de Agotamiento es 6.", "This condition is cumulative. Each time you receive it, you gain 1 Exhaustion level. You die if your Exhaustion level is 6."),
			s("Pruebas de D20 afectadas", "D20 Tests Affected", "Cuando haces una Prueba de D20, la tirada se reduce en 2 veces tu nivel de Agotamiento.", "When you make a D20 Test, the roll is reduced by 2 times your Exhaustion level."),
			s("Velocidad reducida", "Speed Reduced", "Tu Velocidad se reduce en un número de pies igual a 5 veces tu nivel de Agotamiento.", "Your Speed is reduced by a number of feet equal to 5 times your Exhaustion level."),
			s("Eliminar niveles de agotamiento", "Removing Exhaustion Levels", "Terminar un Descanso Largo elimina 1 de tus niveles de Agotamiento. Cuando tu nivel de Agotamiento llega a 0, la condición termina.", "Finishing a Long Rest removes 1 of your Exhaustion levels. When your Exhaustion level reaches 0, the condition ends."),
		],
	},
	{
		id: "frightened",
		name: { es: "Asustado", en: "Frightened" },
		icon: "ghost",
		color: "#9c36b5",
		sections: [
			s("Pruebas de característica y ataques afectados", "Ability Checks and Attacks Affected", "Tienes Desventaja en las pruebas de característica y tiradas de ataque mientras la fuente de tu miedo esté en tu línea de visión.", "You have Disadvantage on ability checks and attack rolls while the source of fear is within line of sight."),
			s("No puede acercarse", "Can't Approach", "No puedes acercarte voluntariamente a la fuente de tu miedo.", "You can't willingly move closer to the source of fear."),
		],
	},
	{
		id: "grappled",
		name: { es: "Apresado", en: "Grappled" },
		icon: "grab",
		color: "#a9714b",
		sections: [
			s("Velocidad 0", "Speed 0", "Tu Velocidad es 0 y no puede aumentar.", "Your Speed is 0 and can't increase."),
			s("Ataques afectados", "Attacks Affected", "Tienes Desventaja en las tiradas de ataque contra cualquier objetivo que no sea quien te apresa.", "You have Disadvantage on attack rolls against any target other than the grappler."),
			s("Movible", "Movable", "Quien te apresa puede arrastrarte o cargarte cuando se mueve, pero cada pie de movimiento le cuesta 1 pie adicional, a menos que seas de tamaño Diminuto o dos o más tamaños menores que él.", "The grappler can drag or carry you when it moves, but every foot of movement costs it 1 extra foot unless you are Tiny or two or more sizes smaller than it."),
		],
	},
	{
		id: "incapacitated",
		name: { es: "Incapacitado", en: "Incapacitated" },
		icon: "ban",
		color: "#fa5252",
		sections: [
			s("Inactivo", "Inactive", "No puedes realizar ninguna Acción, Acción Adicional ni Reacción.", "You can't take any action, Bonus Action, or Reaction."),
			s("Sin concentración", "No Concentration", "Tu Concentración se rompe.", "Your Concentration is broken."),
			s("Sin habla", "Speechless", "No puedes hablar.", "You can't speak."),
			s("Sorprendido", "Surprised", "Si estás Incapacitado cuando tiras Iniciativa, tienes Desventaja en la tirada.", "If you're Incapacitated when you roll Initiative, you have Disadvantage on the roll."),
		],
	},
	{
		id: "invisible",
		name: { es: "Invisible", en: "Invisible" },
		icon: "venetian-mask",
		color: "#74c0fc",
		sections: [
			s("Sorpresa", "Surprise", "Si eres Invisible cuando tiras Iniciativa, tienes Ventaja en la tirada.", "If you're Invisible when you roll Initiative, you have Advantage on the roll."),
			s("Oculto", "Concealed", "No te ves afectado por ningún efecto que requiera que su objetivo sea visto, a menos que el creador del efecto pueda verte de alguna manera. Cualquier equipo que lleves puesto o transportes también está oculto.", "You aren't affected by any effect that requires its target to be seen unless the effect's creator can somehow see you. Any equipment you are wearing or carrying is also concealed."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Desventaja, y tus tiradas de ataque tienen Ventaja. Si una criatura puede verte de alguna manera, no obtienes este beneficio contra esa criatura.", "Attack rolls against you have Disadvantage, and your attack rolls have Advantage. If a creature can somehow see you, you don't gain this benefit against that creature."),
		],
	},
	{
		id: "paralyzed",
		name: { es: "Paralizado", en: "Paralyzed" },
		icon: "zap",
		color: "#fcc419",
		implies: ["incapacitated"],
		sections: [
			s("Incapacitado", "Incapacitated", "Tienes la condición de Incapacitado.", "You have the Incapacitated condition."),
			s("Velocidad 0", "Speed 0", "Tu Velocidad es 0 y no puede aumentar.", "Your Speed is 0 and can't increase."),
			s("Tiradas de salvación afectadas", "Saving Throws Affected", "Fallas automáticamente las tiradas de salvación de Fuerza y Destreza.", "You automatically fail Strength and Dexterity saving throws."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja.", "Attack rolls against you have Advantage."),
			s("Impactos críticos automáticos", "Automatic Critical Hits", "Cualquier tirada de ataque que te impacte es un Impacto Crítico si el atacante está a 5 pies de ti o menos.", "Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you."),
		],
	},
	{
		id: "petrified",
		name: { es: "Petrificado", en: "Petrified" },
		icon: "mountain",
		color: "#adb5bd",
		implies: ["incapacitated"],
		sections: [
			s("Convertido en sustancia inanimada", "Turned to Inanimate Substance", "Te transformas, junto con cualquier objeto no mágico que lleves puesto o transportes, en una sustancia inanimada sólida (generalmente piedra). Tu peso aumenta por un factor de diez, y dejas de envejecer.", "You are transformed, along with any nonmagical objects you are wearing and carrying, into a solid inanimate substance (usually stone). Your weight increases by a factor of ten, and you cease aging."),
			s("Incapacitado", "Incapacitated", "Tienes la condición de Incapacitado.", "You have the Incapacitated condition."),
			s("Velocidad 0", "Speed 0", "Tu Velocidad es 0 y no puede aumentar.", "Your Speed is 0 and can't increase."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja.", "Attack rolls against you have Advantage."),
			s("Tiradas de salvación afectadas", "Saving Throws Affected", "Fallas automáticamente las tiradas de salvación de Fuerza y Destreza.", "You automatically fail Strength and Dexterity saving throws."),
			s("Resistencia al daño", "Resist Damage", "Tienes Resistencia a todo el daño.", "You have Resistance to all damage."),
			s("Inmunidad al veneno", "Poison Immunity", "Tienes Inmunidad a la condición de Envenenado.", "You have Immunity to the Poisoned condition."),
		],
	},
	{
		id: "poisoned",
		name: { es: "Envenenado", en: "Poisoned" },
		icon: "biohazard",
		color: "#51cf66",
		sections: [
			s("Pruebas de característica y ataques afectados", "Ability Checks and Attacks Affected", "Tienes Desventaja en las tiradas de ataque y pruebas de característica.", "You have Disadvantage on attack rolls and ability checks."),
		],
	},
	{
		id: "prone",
		name: { es: "Derribado", en: "Prone" },
		icon: "arrow-down-to-line",
		color: "#ced4da",
		sections: [
			s("Movimiento restringido", "Restricted Movement", "Tus únicas opciones de movimiento son gatear o gastar una cantidad de movimiento igual a la mitad de tu Velocidad (redondeando hacia abajo) para incorporarte y así terminar la condición. Si tu Velocidad es 0, no puedes incorporarte.", "Your only movement options are to crawl or to spend an amount of movement equal to half your Speed (round down) to right yourself and thereby end the condition. If your Speed is 0, you can't right yourself."),
			s("Ataques afectados", "Attacks Affected", "Tienes Desventaja en tus tiradas de ataque. Una tirada de ataque contra ti tiene Ventaja si el atacante está a 5 pies de ti o menos. De lo contrario, esa tirada de ataque tiene Desventaja.", "You have Disadvantage on attack rolls. An attack roll against you has Advantage if the attacker is within 5 feet of you. Otherwise, that attack roll has Disadvantage."),
		],
	},
	{
		id: "restrained",
		name: { es: "Sujeto", en: "Restrained" },
		icon: "link",
		color: "#a9714b",
		sections: [
			s("Velocidad 0", "Speed 0", "Tu Velocidad es 0 y no puede aumentar.", "Your Speed is 0 and can't increase."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja, y tus tiradas de ataque tienen Desventaja.", "Attack rolls against you have Advantage, and your attack rolls have Disadvantage."),
			s("Tiradas de salvación afectadas", "Saving Throws Affected", "Tienes Desventaja en las tiradas de salvación de Destreza.", "You have Disadvantage on Dexterity saving throws."),
		],
	},
	{
		id: "stunned",
		name: { es: "Aturdido", en: "Stunned" },
		icon: "sparkles",
		color: "#ffd43b",
		implies: ["incapacitated"],
		sections: [
			s("Incapacitado", "Incapacitated", "Tienes la condición de Incapacitado.", "You have the Incapacitated condition."),
			s("Tiradas de salvación afectadas", "Saving Throws Affected", "Fallas automáticamente las tiradas de salvación de Fuerza y Destreza.", "You automatically fail Strength and Dexterity saving throws."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja.", "Attack rolls against you have Advantage."),
		],
	},
	{
		id: "unconscious",
		name: { es: "Inconsciente", en: "Unconscious" },
		icon: "moon",
		color: "#748ffc",
		implies: ["incapacitated", "prone"],
		sections: [
			s("Inerte", "Inert", "Tienes las condiciones de Incapacitado y Derribado, y sueltas cualquier cosa que estés sosteniendo. Cuando esta condición termina, sigues Derribado.", "You have the Incapacitated and Prone conditions, and you drop whatever you're holding. When this condition ends, you remain Prone."),
			s("Velocidad 0", "Speed 0", "Tu Velocidad es 0 y no puede aumentar.", "Your Speed is 0 and can't increase."),
			s("Ataques afectados", "Attacks Affected", "Las tiradas de ataque contra ti tienen Ventaja.", "Attack rolls against you have Advantage."),
			s("Tiradas de salvación afectadas", "Saving Throws Affected", "Fallas automáticamente las tiradas de salvación de Fuerza y Destreza.", "You automatically fail Strength and Dexterity saving throws."),
			s("Impactos críticos automáticos", "Automatic Critical Hits", "Cualquier tirada de ataque que te impacte es un Impacto Crítico si el atacante está a 5 pies de ti o menos.", "Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you."),
			s("Inconsciente del entorno", "Unaware", "No eres consciente de tu entorno.", "You're unaware of your surroundings."),
		],
		rules: { hpTriggers: [{ threshold: "zero", who: "allies" }], leaves: [PRONE_ID], announce: true },
	},
];

/** Al terminar Inconsciente sigues Derribado (regla de la condición). */
// ---------- Catálogo: integradas (con los cambios del usuario) y personalizadas ----------

/** Descripción de una integrada en Markdown: cada apartado con título es un encabezado `##`. */
export function builtinMarkdown(b: BuiltinCondition): string {
	return b.sections.map((x) => (tr(x.title) ? `## ${tr(x.title)}\n\n${tr(x.text)}` : tr(x.text))).join("\n\n");
}

/** Automatismos originales de una integrada, con los textos en el idioma actual. */
export function builtinRules(b: BuiltinCondition): ConditionRules {
	const r = b.rules;
	if (!r) return {};
	const { damageSave, ...rest } = r;
	return structuredClone({ ...rest, ...(damageSave ? { damageSave: { ability: tr(damageSave.ability) } } : {}) });
}

/** Condición integrada con los cambios del usuario (nombre, descripción, icono, color, automatismos…). */
export function builtinInfo(b: BuiltinCondition, o?: ConditionOverride): ConditionInfo {
	const color = o && "color" in o ? (o.color ?? undefined) : b.color;
	const maxLevel = o && "maxLevel" in o ? (o.maxLevel ?? undefined) : b.maxLevel;
	return {
		id: b.id,
		name: o?.name?.trim() || tr(b.name),
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
			return (t.percent ?? 50) === 50 ? T("PG a la mitad o menos", "HP at half or less") : T(`PG al ${t.percent} % o menos`, `HP at ${t.percent}% or less`);
		case "zero":
			return T("0 PG o menos", "0 HP or less");
		case "negative-max":
			return T("PG en su máximo negativo o menos", "HP at minus its maximum or less");
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
		if (hpTriggerHolds(t, c)) return { reason: hpTriggerText(t), endsWhen: T("cuando cambian los PG", "when HP changes") };
	for (const t of info.rules.levelTriggers ?? []) {
		const source = t.conditionId;
		const src = source !== info.id ? conditionById(source, catalog) : null;
		if (src && entryLevel(entries, source) >= t.minLevel)
			return { reason: `${src.name} ${t.minLevel}`, endsWhen: T(`al bajar ${src.name}`, `when ${src.name} goes down`) };
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
