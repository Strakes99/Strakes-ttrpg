import { Localized, T, tr } from "../i18n";
import { ConditionEntry, ConditionOverride, CustomCondition } from "../types";

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

/**
 * Condiciones de las reglas básicas (SRD 5.2, licencia CC-BY-4.0).
 * Cada una tiene un icono de Lucide y un color; `implies` son las condiciones
 * que aplica automáticamente (p. ej. Paralizado → Incapacitado).
 */
export interface ConditionSection {
	title: Localized;
	text: Localized;
}

export interface BuiltinCondition {
	id: string;
	name: Localized;
	icon: string;
	color: string;
	implies?: string[];
	/** Niveles acumulables (Agotamiento: 6). */
	maxLevel?: number;
	sections: ConditionSection[];
}

/** Lo que necesita la interfaz para pintar y describir una condición (integrada o personalizada). */
export interface ConditionInfo {
	id: string;
	name: string;
	icon: string;
	/** Color del icono; undefined = color nativo (SVG). */
	color?: string;
	implies: string[];
	maxLevel?: number;
	sections: { title: string; text: string }[];
	/** Texto libre (condiciones personalizadas). */
	description?: string;
	custom: boolean;
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
	},
];

/** Al terminar Inconsciente sigues Derribado (regla de la condición). */
export const REMAINS_AFTER: Record<string, string[]> = { unconscious: ["prone"] };

/** Condición integrada con los cambios del usuario (nombre, descripción, icono, color, etc.). */
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
		sections: b.sections.map((x) => ({ title: tr(x.title), text: tr(x.text) })),
		description: o?.description,
		custom: false,
	};
}

/** Apartados de una condición integrada como texto editable («Título. Texto», separados por línea en blanco). */
export function sectionsToText(sections: { title: string; text: string }[]): string {
	return sections.map((x) => (x.title ? `${x.title}. ${x.text}` : x.text)).join("\n\n");
}

export function customInfo(c: CustomCondition): ConditionInfo {
	return {
		id: c.id,
		name: c.name,
		icon: c.icon,
		color: c.color,
		implies: (c.implies ?? []).filter((id) => id !== c.id),
		maxLevel: c.maxLevel && c.maxLevel > 1 ? c.maxLevel : undefined,
		sections: [],
		description: c.description,
		custom: true,
	};
}

/** Todas las condiciones disponibles: integradas (por orden alfabético del idioma) y personalizadas. */
export function allConditions(catalog: ConditionCatalog): ConditionInfo[] {
	const builtins = BUILTIN_CONDITIONS.map((b) => builtinInfo(b, catalog.conditionOverrides[b.id])).sort((a, b) => a.name.localeCompare(b.name));
	return [...builtins, ...catalog.customConditions.map(customInfo)];
}

export function conditionById(id: string, catalog: ConditionCatalog): ConditionInfo | null {
	const b = BUILTIN_CONDITIONS.find((x) => x.id === id);
	if (b) return builtinInfo(b, catalog.conditionOverrides[b.id]);
	const c = catalog.customConditions.find((x) => x.id === id);
	return c ? customInfo(c) : null;
}

/** Una condición tal como se ve en un combatiente: elegida a mano, aplicada por otra o automática. */
export interface ActiveCondition {
	info: ConditionInfo;
	level?: number;
	/** Nombres de las condiciones que la aplican (vacío si se eligió a mano). */
	impliedBy: string[];
	explicit: boolean;
	/** Activada automáticamente por los PG (Ensangrentado). */
	auto?: boolean;
}

/**
 * ¿Muerto por sus PG? Enemigo: 0 PG o menos. PJ/aliado: PG iguales o inferiores al
 * negativo de sus PG máximos (p. ej. −45 con 45 máximos).
 */
export function isDead(c: { isPlayer: boolean; hp: number | null; maxHp: number | null }): boolean {
	if (c.hp === null) return false;
	if (!c.isPlayer) return c.hp <= 0;
	return c.maxHp !== null && c.maxHp > 0 && c.hp <= -c.maxHp;
}

/**
 * Enemigo derrotado: 0 PG o menos. Se tacha, su turno se salta y los jugadores dejan de
 * ver sus PG y sus condiciones (salvo Muerto). Los PJ y aliados nunca cuentan como
 * derrotados: a 0 PG quedan Inconscientes.
 */
export function isDefeatedEnemy(c: { isPlayer: boolean; hp: number | null }): boolean {
	return !c.isPlayer && c.hp !== null && c.hp <= 0;
}

/** Motivo de una condición automática, para mostrarlo al DM. */
/** Por qué se aplica sola una condición automática (para tooltips y avisos). */
export function autoReason(id: string): string {
	if (id === "bloodied") return T("PG a la mitad o menos", "HP at half or less");
	return T("por sus PG", "from its HP");
}

/** ¿Está Ensangrentado por sus PG? (la mitad de sus PG máximos o menos). */
export function isBloodied(hp: number | null, maxHp: number | null): boolean {
	return hp !== null && maxHp !== null && maxHp > 0 && hp <= maxHp / 2;
}

/**
 * Condiciones efectivas de un combatiente: las elegidas, las que estas aplican (en
 * cadena: una condición propia puede aplicar Paralizado, que aplica Incapacitado) y
 * Ensangrentado si sus PG lo indican. Sin duplicados; las que ya no existen se ignoran.
 */
export function activeConditions(entries: ConditionEntry[], catalog: ConditionCatalog, opts: { bloodied?: boolean; dead?: boolean } = {}): ActiveCondition[] {
	const out: ActiveCondition[] = [];
	const byId = new Map<string, ActiveCondition>();
	for (const e of entries) {
		const info = conditionById(e.id, catalog);
		if (!info || byId.has(info.id)) continue;
		const a: ActiveCondition = { info, level: info.maxLevel ? Math.max(1, Math.min(info.maxLevel, e.level ?? 1)) : undefined, impliedBy: [], explicit: true };
		byId.set(info.id, a);
		out.push(a);
	}
	// Automáticas por PG: Muerto y Ensangrentado.
	for (const [on, id] of [[opts.dead, DEAD_ID], [opts.bloodied, BLOODIED_ID]] as const) {
		if (!on || byId.has(id)) continue;
		const info = conditionById(id, catalog);
		if (!info) continue;
		const a: ActiveCondition = { info, impliedBy: [], explicit: false, auto: true };
		byId.set(id, a);
		out.push(a);
	}
	// Recorre en anchura: las condiciones aplicadas pueden aplicar a su vez otras.
	for (let i = 0; i < out.length; i++) {
		const a = out[i];
		for (const imp of a.info.implies) {
			const existing = byId.get(imp);
			if (existing) {
				if (!existing.explicit && !existing.impliedBy.includes(a.info.name)) existing.impliedBy.push(a.info.name);
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

/** CD de la tirada de Constitución para mantener la Concentración tras recibir daño. */
export function concentrationDC(damage: number): number {
	return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}
