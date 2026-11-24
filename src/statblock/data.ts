/**
 * Statblocks (1.4): formato de los datos y lectura de las propiedades de la nota.
 *
 * Los datos van en las propiedades (frontmatter) de la nota, sueltas y con los nombres en inglés
 * (`ac`, `hp`, `cr`…), para que sirvan en las Bases. Los valores de listas cerradas (tamaños, tipos,
 * daños, habilidades, sentidos…) se guardan con su id en inglés y se dibujan traducidos. Detalle del
 * formato en `docs/hoja-de-ruta.md` §10.1 y en `docs/statblocks.md`.
 *
 * `readStatblock` acepta lo que haya en las propiedades sin fallar: lo que no tenga la forma esperada
 * se ignora (la nota la puede haber escrito el usuario a mano).
 */

/** Lenguaje del bloque de código que dibuja el statblock de la nota. */
export const STATBLOCK_BLOCK = "strakes-statblock";

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export type Size = (typeof SIZES)[number];

/** Los 14 tipos de criatura de 2024. */
export const CREATURE_TYPES = [
	"aberration",
	"beast",
	"celestial",
	"construct",
	"dragon",
	"elemental",
	"fey",
	"fiend",
	"giant",
	"humanoid",
	"monstrosity",
	"ooze",
	"plant",
	"undead",
] as const;

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

/** Las 18 habilidades y su característica. */
export const SKILLS: Record<string, Ability> = {
	acrobatics: "dex",
	animal_handling: "wis",
	arcana: "int",
	athletics: "str",
	deception: "cha",
	history: "int",
	insight: "wis",
	intimidation: "cha",
	investigation: "int",
	medicine: "wis",
	nature: "int",
	perception: "wis",
	performance: "cha",
	persuasion: "cha",
	religion: "int",
	sleight_of_hand: "dex",
	stealth: "dex",
	survival: "wis",
};

export const DAMAGE_TYPES = [
	"acid",
	"bludgeoning",
	"cold",
	"fire",
	"force",
	"lightning",
	"necrotic",
	"piercing",
	"poison",
	"psychic",
	"radiant",
	"slashing",
	"thunder",
] as const;

/** Velocidades: caminando va primero; el resto se dibuja en orden alfabético del idioma. */
export const SPEEDS = ["walk", "burrow", "climb", "fly", "swim"] as const;
export const SENSES = ["blindsight", "darkvision", "tremorsense", "truesight"] as const;

/** Secciones de rasgos y acciones, en el orden de 2024 (los conjuros van entre Rasgos y Acciones). */
export const ENTRY_SECTIONS = ["traits", "actions", "bonus_actions", "reactions", "legendary_actions", "mythic_actions"] as const;
export type EntrySection = (typeof ENTRY_SECTIONS)[number];

export type Proficiency = "none" | "proficient" | "expertise";
/** Un valor que puede ser un número o un texto («14 + the spell's level»). */
export type NumOrText = number | string;

export type UsesPer = "day" | "short" | "long";
/** Recarga: el número mínimo del d6 (5 → «Recarga 5–6») o tras un descanso. */
export type Recharge = number | "short" | "long" | "short_or_long";

export interface StatEntry {
	name: string;
	/** Markdown. */
	text: string;
	uses?: number;
	uses_lair?: number;
	uses_per?: UsesPer;
	recharge?: Recharge;
}

export type SpellUse = "action" | "bonus_action" | "reaction" | "trait";

export interface SpellsPerDay {
	uses: number;
	/** Cada conjuro de la lista tiene sus propios usos («1/día cada uno»). */
	each: boolean;
	spells: string[];
}

export interface SpellLevel {
	/** 0 = trucos. */
	level: number;
	slots?: number;
	spells: string[];
}

export interface SpellcastingBlock {
	name: string;
	ability?: Ability;
	use: SpellUse;
	text: string;
	at_will: string[];
	per_day: SpellsPerDay[];
	levels: SpellLevel[];
	footer: string;
}

export interface Statblock {
	/** `dnd5e-2024` o `dnd5e-2014` (por ahora se dibujan igual). */
	system: string;
	name: string;
	size: Size[];
	type: string[];
	subtype: string[];
	swarm_creature_size: Size[];
	alignment: string;

	ac?: NumOrText;
	ac_note: string;
	initiative_proficiency: Proficiency;
	initiative?: NumOrText;
	hp?: NumOrText;
	hp_formula: string;
	speed: Partial<Record<(typeof SPEEDS)[number], NumOrText>>;
	hover: boolean;
	cr: string;
	xp?: NumOrText;
	pb?: NumOrText;
	lair: boolean;
	xp_lair?: NumOrText;

	scores: Partial<Record<Ability, number>>;
	save_proficiencies: Ability[];
	saves: Partial<Record<Ability, NumOrText>>;

	skill_proficiencies: Record<string, Proficiency>;
	skills: Record<string, NumOrText>;
	all_skills: boolean;
	vulnerabilities: string[];
	resistances: string[];
	immunities: string[];
	condition_immunities: string[];
	gear: string[];
	senses: Partial<Record<(typeof SENSES)[number], NumOrText>>;
	senses_other: string[];
	passive_perception?: NumOrText;
	languages: string[];

	entries: Record<EntrySection, StatEntry[]>;
	spellcasting: SpellcastingBlock[];
	legendary_uses?: number;
	legendary_uses_lair?: number;
	legendary_header: string;
	mythic_header: string;
	short_name: string;
	named: boolean;
	/** Columnas de este statblock; sin valor, las de los ajustes. */
	columns?: 1 | 2;
}

// ---------------------------------------------------------------- lectura

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
/** Número finito, o undefined. Acepta un texto con un número («12»). */
const num = (v: unknown): number | undefined => {
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (typeof v === "string" && /^[+-]?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
	return undefined;
};
/** Número si lo es, texto si no; vacío = undefined. */
const numOrText = (v: unknown): NumOrText | undefined => num(v) ?? (str(v) || undefined);
/** Una lista de textos; un texto suelto cuenta como lista de uno. */
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
const bool = (v: unknown): boolean => v === true || v === "true" || v === "yes";
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
	const s = str(v).toLowerCase();
	return (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
};
const sizes = (v: unknown): Size[] => lower(list(v)).filter((s): s is Size => (SIZES as readonly string[]).includes(s));

function record<T>(v: unknown, keys: readonly string[], read: (x: unknown) => T | undefined): Partial<Record<string, T>> {
	const out: Partial<Record<string, T>> = {};
	if (!isObj(v)) return out;
	for (const [k, x] of Object.entries(v)) {
		const key = k.toLowerCase();
		if (!keys.includes(key)) continue;
		const val = read(x);
		if (val !== undefined) out[key] = val;
	}
	return out;
}

function readRecharge(v: unknown): Recharge | undefined {
	const n = num(v);
	if (n !== undefined) return n >= 1 && n <= 6 ? Math.round(n) : undefined;
	return pick(v, ["short", "long", "short_or_long"] as const);
}

function readEntries(v: unknown): StatEntry[] {
	if (!Array.isArray(v)) return [];
	const out: StatEntry[] = [];
	for (const x of v) {
		if (!isObj(x)) continue;
		const e: StatEntry = { name: str(x.name), text: typeof x.text === "string" ? x.text : str(x.text) };
		if (!e.name && !e.text) continue;
		const uses = num(x.uses);
		if (uses !== undefined && uses > 0) e.uses = Math.round(uses);
		const lair = num(x.uses_lair);
		if (lair !== undefined && lair > 0) e.uses_lair = Math.round(lair);
		const per = pick(x.uses_per, ["day", "short", "long"] as const);
		if (per) e.uses_per = per;
		const recharge = readRecharge(x.recharge);
		if (recharge !== undefined) e.recharge = recharge;
		out.push(e);
	}
	return out;
}

function readSpellcasting(v: unknown): SpellcastingBlock[] {
	if (!Array.isArray(v)) return [];
	const out: SpellcastingBlock[] = [];
	for (const x of v) {
		if (!isObj(x)) continue;
		const perDay = (Array.isArray(x.per_day) ? x.per_day : isObj(x.per_day) ? [x.per_day] : []).filter(isObj);
		const levels = (Array.isArray(x.levels) ? x.levels : []).filter(isObj);
		out.push({
			name: str(x.name),
			ability: pick(x.ability, ABILITIES),
			use: pick(x.use, ["action", "bonus_action", "reaction", "trait"] as const) ?? "action",
			text: typeof x.text === "string" ? x.text : "",
			at_will: list(x.at_will),
			per_day: perDay
				.map((p) => ({ uses: Math.max(1, Math.round(num(p.uses) ?? 1)), each: bool(p.each), spells: list(p.spells) }))
				.filter((p) => p.spells.length),
			levels: levels
				.map((l) => {
					const slots = num(l.slots);
					return { level: Math.max(0, Math.round(num(l.level) ?? 0)), slots: slots !== undefined ? Math.round(slots) : undefined, spells: list(l.spells) };
				})
				.filter((l) => l.spells.length)
				.sort((a, b) => a.level - b.level),
			footer: typeof x.footer === "string" ? x.footer : "",
		});
	}
	return out;
}

/** Quita el prefijo y el sufijo de los statblocks del nombre de la nota («ST-Goblin» → «Goblin»). */
export function nameFromNote(basename: string, prefix: string, suffix: string): string {
	let n = basename;
	if (prefix && n.startsWith(prefix)) n = n.slice(prefix.length);
	if (suffix && n.endsWith(suffix)) n = n.slice(0, n.length - suffix.length);
	return n.trim() || basename;
}

/** ¿Las propiedades de la nota son de un statblock? (tienen `statblock`). */
export function isStatblock(fm: unknown): boolean {
	return isObj(fm) && !!str(fm.statblock);
}

/**
 * Lee el statblock de las propiedades de una nota. `fallbackName` es el nombre de la nota sin prefijo
 * ni sufijo, para cuando `name` está vacío.
 */
export function readStatblock(fm: Raw, fallbackName: string): Statblock {
	const entries = {} as Record<EntrySection, StatEntry[]>;
	for (const s of ENTRY_SECTIONS) entries[s] = readEntries(fm[s]);
	const prof = (v: unknown): Proficiency | undefined => pick(v, ["none", "proficient", "expertise"] as const);
	const skillKeys = Object.keys(SKILLS);
	const legendary = num(fm.legendary_uses);
	const legendaryLair = num(fm.legendary_uses_lair);
	return {
		system: str(fm.statblock),
		name: str(fm.name) || fallbackName,
		size: sizes(fm.size),
		type: list(fm.type),
		subtype: list(fm.subtype),
		swarm_creature_size: sizes(fm.swarm_creature_size),
		alignment: str(fm.alignment),

		ac: numOrText(fm.ac),
		ac_note: str(fm.ac_note),
		initiative_proficiency: prof(fm.initiative_proficiency) ?? "none",
		initiative: numOrText(fm.initiative),
		hp: numOrText(fm.hp),
		hp_formula: str(fm.hp_formula),
		speed: record(fm.speed, SPEEDS, numOrText),
		hover: bool(fm.hover) || (isObj(fm.speed) && bool(fm.speed.hover)),
		cr: str(fm.cr),
		xp: numOrText(fm.xp),
		pb: numOrText(fm.pb),
		lair: bool(fm.lair),
		xp_lair: numOrText(fm.xp_lair),

		scores: Object.fromEntries(ABILITIES.map((a) => [a, num(fm[a])]).filter(([, v]) => v !== undefined)) as Partial<Record<Ability, number>>,
		save_proficiencies: lower(list(fm.save_proficiencies)).filter((a): a is Ability => (ABILITIES as readonly string[]).includes(a)),
		saves: record(fm.saves, ABILITIES, numOrText),

		skill_proficiencies: record(fm.skill_proficiencies, skillKeys, prof) as Record<string, Proficiency>,
		skills: record(fm.skills, skillKeys, numOrText) as Record<string, NumOrText>,
		all_skills: bool(fm.all_skills),
		vulnerabilities: list(fm.vulnerabilities),
		resistances: list(fm.resistances),
		immunities: list(fm.immunities),
		condition_immunities: list(fm.condition_immunities),
		gear: list(fm.gear),
		senses: record(fm.senses, SENSES, numOrText),
		senses_other: list(fm.senses_other),
		passive_perception: numOrText(fm.passive_perception),
		languages: list(fm.languages),

		entries,
		spellcasting: readSpellcasting(fm.spellcasting),
		legendary_uses: legendary !== undefined && legendary > 0 ? Math.round(legendary) : undefined,
		legendary_uses_lair: legendaryLair !== undefined && legendaryLair > 0 ? Math.round(legendaryLair) : undefined,
		legendary_header: typeof fm.legendary_header === "string" ? fm.legendary_header.trim() : "",
		mythic_header: typeof fm.mythic_header === "string" ? fm.mythic_header.trim() : "",
		short_name: str(fm.short_name),
		named: bool(fm.named),
		columns: num(fm.columns) === 1 ? 1 : num(fm.columns) === 2 ? 2 : undefined,
	};
}
