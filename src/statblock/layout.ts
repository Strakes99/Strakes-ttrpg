import { currentLanguage, numberLocale, T, TranslationKey } from "../i18n";
import en from "../i18n/locales/en.json";
import { ConditionCatalog, conditionById } from "../initiative/conditions";
import { derive, Derived, signed, signedValue } from "./compute";
import {
	ABILITIES,
	CREATURE_TYPES,
	DAMAGE_TYPES,
	EntrySection,
	NumOrText,
	SENSES,
	SPEEDS,
	SpellcastingBlock,
	StatEntry,
	Statblock,
} from "./data";

/**
 * Maqueta de un statblock (1.4): qué se muestra, con qué texto y en qué orden, sin DOM (`render.ts` lo
 * dibuja). Sigue la disposición de los statblocks oficiales de 2024, con estos cambios del desarrollador
 * (2026-11-23): el BC va debajo de la iniciativa (no junto al VD y los PX), y las características van en
 * una tabla a todo el ancho (puntuación, Mod y Salv.). Todo lo que se ve sale en el idioma de la interfaz.
 * Hasta el 2026-11-23 se generaba un callout `[!statblocks]` de ITS Theme.
 *
 * Regla de los campos vacíos: lo que no tiene valor no se dibuja, ni su etiqueta ni su puntuación
 * (nunca «Dragón (), Legal bueno»). La única excepción son los idiomas: «Idiomas —».
 */

export interface StatblockOptions {
	/** Velocidad y sentidos también en metros, entre paréntesis («60 ft. (18 m)»). */
	metric: boolean;
	/** Para dar el nombre traducido de las inmunidades a condiciones del SRD. */
	catalog: ConditionCatalog;
}

const tk = (key: string, vars?: Record<string, string | number | null | undefined>) => T(key as TranslationKey, vars);
const fmt = (n: number) => n.toLocaleString(numberLocale(), { maximumFractionDigits: 2 });
/** Valor a mano o calculado: un número con el formato del idioma, o el texto tal cual. */
const val = (v: NumOrText) => (typeof v === "number" ? fmt(v) : v);
const known = (list: readonly string[], id: string) => list.includes(id.toLowerCase());

type ListFormatCtor = new (lang: string, o: { type: "conjunction" | "disjunction" }) => { format(items: string[]): string };
const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
/** «A, B o C» al estilo del idioma. */
function listOr(items: string[]): string {
	return ListFormat ? new ListFormat(currentLanguage(), { type: "disjunction" }).format(items) : items.join(", ");
}

/** Marcas de 5etools que queden en un texto (`{@condition Grappled}`): por ahora, solo su texto. */
export function plainTags(text: string): string {
	return text.replace(/\{@\w+\s+([^{}]*)\}/g, (_all, inner: string) => {
		const parts = inner.split("|");
		return (parts[2] || parts[0]).trim();
	});
}

/**
 * Frases conocidas en inglés → clave de su traducción. Las notas de la CA y los sentidos de texto se
 * guardan como se escribieron o importaron (en inglés) y se traducen al dibujarlos si son una de estas.
 */
const ARMOR: Record<string, string> = {
	"natural armor": "natural_armor",
	"padded armor": "padded",
	padded: "padded",
	"leather armor": "leather",
	leather: "leather",
	"studded leather armor": "studded_leather",
	"studded leather": "studded_leather",
	"hide armor": "hide",
	hide: "hide",
	"chain shirt": "chain_shirt",
	"scale mail": "scale_mail",
	breastplate: "breastplate",
	"half plate armor": "half_plate",
	"half plate": "half_plate",
	"ring mail": "ring_mail",
	"chain mail": "chain_mail",
	"splint armor": "splint",
	splint: "splint",
	"plate armor": "plate",
	plate: "plate",
	shield: "shield",
	"armor scraps": "armor_scraps",
	"patchwork armor": "patchwork",
};
const SENSE_TEXT: Record<string, string> = {
	echolocation: "echolocation",
	"blind beyond this radius": "blind_beyond",
};

/**
 * Traduce cada parte de un texto separado por comas que sea una frase conocida («plate armor, shield»
 * → «armadura de placas, escudo»); lo demás, tal cual. Sin distinguir mayúsculas.
 */
export function knownPhrases(text: string, dict: Record<string, string>, prefix: string): string {
	return plainTags(text)
		.split(",")
		.map((part) => {
			const id = dict[part.trim().toLowerCase()];
			return id ? `${part.match(/^\s*/)?.[0] ?? ""}${tk(`${prefix}.${id}`)}` : part;
		})
		.join(",");
}


// ---------------------------------------------------------------- cabecera

/** Género gramatical del tipo («m» o «f»; los desconocidos, «m»). Con varios, «m» si alguno lo es. */
function typeGender(types: string[]): "m" | "f" {
	const known_ = types.filter((t) => known(CREATURE_TYPES, t));
	if (!known_.length) return "m";
	return known_.every((t) => tk(`statblock.type.${t}.gender`) === "f") ? "f" : "m";
}

function sizeName(size: string, gender: "m" | "f", plural = false): string {
	const suffix = (plural ? ".pl" : "") + (gender === "f" ? (plural ? "f" : ".f") : "");
	return tk(`statblock.size.${size}${suffix}`);
}

function typeName(type: string, plural = false): string {
	return known(CREATURE_TYPES, type) ? tk(`statblock.type.${type.toLowerCase()}${plural ? ".pl" : ""}`) : type;
}

export const ALIGNMENTS = [
	"lawful_good",
	"neutral_good",
	"chaotic_good",
	"lawful_neutral",
	"neutral",
	"chaotic_neutral",
	"lawful_evil",
	"neutral_evil",
	"chaotic_evil",
	"unaligned",
	"any",
	"any_chaotic",
	"any_lawful",
	"any_good",
	"any_evil",
	"any_neutral",
	"any_non_good",
	"any_non_evil",
	"any_non_lawful",
	"any_non_chaotic",
];

/** Alineamiento traducido si es una de las frases conocidas (en inglés); si no, tal cual. */
export function alignmentName(alignment: string, gender: "m" | "f"): string {
	let id = alignment.trim().toLowerCase().replace(/\s+alignment$/, "").replace(/[\s-]+/g, "_");
	if (id === "true_neutral") id = "neutral";
	if (!ALIGNMENTS.includes(id)) return alignment;
	return tk(`statblock.alignment.${id}${gender === "f" ? ".f" : ""}`);
}

/**
 * Lo escrito en el campo de alineamiento, para guardarlo: si es una frase conocida (traducida, en
 * masculino o femenino, o en inglés), la frase en inglés; si no, el texto tal cual.
 */
export function alignmentFromInput(text: string): string {
	const t = text.trim();
	const low = t.toLowerCase();
	for (const id of ALIGNMENTS) {
		const english = (en as Record<string, string>)[`statblock.alignment.${id}`];
		const forms = [tk(`statblock.alignment.${id}`), tk(`statblock.alignment.${id}.f`), english];
		if (forms.some((f) => f.toLowerCase() === low)) return english;
	}
	return t;
}

/** «Gargantuan Dragon (Metallic), Lawful Good» / «Dragón Gargantuesco (Metallic), Legal Bueno». */
export function headerLine(sb: Statblock): string {
	const gender = typeGender(sb.type);
	let line: string;
	if (sb.swarm_creature_size.length && sb.type.length) {
		line = tk("statblock.swarm", {
			size: listOr(sb.size.map((s) => sizeName(s, "m"))),
			creatureSize: listOr(sb.swarm_creature_size.map((s) => sizeName(s, gender, true))),
			types: listOr(sb.type.map((t) => typeName(t, true))),
		}).trim();
	} else {
		const size = listOr(sb.size.map((s) => sizeName(s, gender)));
		const type = listOr(sb.type.map((t) => typeName(t)));
		line = size && type ? tk("statblock.sizeType", { size, type }) : size || type;
	}
	if (sb.subtype.length) line += `${line ? " " : ""}(${sb.subtype.join(", ")})`;
	if (sb.alignment) line += line ? `${sb.type.length > 1 ? ";" : ","} ${alignmentName(sb.alignment, gender)}` : alignmentName(sb.alignment, gender);
	return line;
}

// ---------------------------------------------------------------- defensa y características

function distance(v: NumOrText, metric: boolean): string {
	if (typeof v !== "number") return v;
	const feet = tk("statblock.feet", { n: fmt(v) });
	return metric ? `${feet} (${tk("statblock.meters", { n: fmt(Math.round(v * 3) / 10) })})` : feet;
}

/** «60 ft., Burrow 40 ft., Fly 80 ft. (hover)»: caminando primero y el resto por orden alfabético. */
export function speedLine(sb: Statblock, metric: boolean): string {
	const collator = new Intl.Collator(currentLanguage());
	const hover = tk("statblock.hover");
	const others = SPEEDS.filter((s) => s !== "walk" && sb.speed[s] !== undefined)
		.map((s) => ({ s, label: tk(`statblock.speed.${s}`) }))
		.sort((a, b) => collator.compare(a.label, b.label))
		.map(({ s, label }) => `${label} ${distance(sb.speed[s] as NumOrText, metric)}${s === "fly" && sb.hover ? ` ${hover}` : ""}`);
	const walk = sb.speed.walk !== undefined ? [distance(sb.speed.walk, metric)] : [];
	const parts = [...walk, ...others];
	if (sb.hover && sb.speed.fly === undefined && parts.length) parts[parts.length - 1] += ` ${hover}`;
	return parts.join(", ");
}

/** Un par etiqueta + valor del bloque superior (CA, Iniciativa, PG, BC). */
export interface LabelValue {
	label: string;
	value: string;
}

/** Una característica: abreviatura, puntuación, modificador y salvación («—» si falta). */
export interface AbilityCell {
	label: string;
	score: string;
	mod: string;
	save: string;
}

/** Una sección (Rasgos, Acciones…): título, introducción opcional (Markdown) y entradas (Markdown). */
export interface LayoutSection {
	title: string;
	intro?: string;
	entries: string[];
}

export interface StatblockLayout {
	name: string;
	/** «Aberración Grande, Legal Malvada». */
	subtitle: string;
	/** Filas de dos casillas: [CA, Iniciativa] y [PG, BC]. Una casilla vacía es null (para no mover la otra). */
	top: (LabelValue | null)[][];
	/** «10 pies, Nadar 40 pies», a lo ancho bajo el bloque superior. */
	speed: string;
	abilities: AbilityCell[] | null;
	/** Con «Mostrar todas las habilidades», la tabla de las 18 (si no, null y van en una línea). */
	allSkills: LabelValue[] | null;
	/** Líneas «**Etiqueta** valor»: Habilidades… Idiomas y, al final, el VD con los PX. */
	lines: LabelValue[];
	sections: LayoutSection[];
}

function topBlock(sb: Statblock, d: Derived): (LabelValue | null)[][] {
	const cellOf = (key: string, value: string | undefined): LabelValue | null => (value ? { label: tk(key), value } : null);
	const ac = sb.ac !== undefined ? `${val(sb.ac)}${sb.ac_note ? ` (${knownPhrases(sb.ac_note, ARMOR, "statblock.armor")})` : ""}` : undefined;
	const init = d.initiative === undefined ? undefined : typeof d.initiative === "number" ? `${signed(d.initiative)} (${10 + d.initiative})` : d.initiative;
	const hp = d.hp !== undefined ? `${val(d.hp)}${sb.hp_formula ? ` (${sb.hp_formula})` : ""}` : sb.hp_formula ? `(${sb.hp_formula})` : undefined;
	const pb = d.pb !== undefined ? signedValue(d.pb) : undefined;
	return [
		[cellOf("statblock.ac", ac), cellOf("statblock.initiative", init)],
		[cellOf("statblock.hp", hp), cellOf("statblock.pb", pb)],
	].filter((r) => r.some(Boolean));
}

function abilityCells(sb: Statblock, d: Derived): AbilityCell[] | null {
	if (!ABILITIES.some((a) => sb.scores[a] !== undefined || sb.saves[a] !== undefined)) return null;
	const none = tk("statblock.none");
	return ABILITIES.map((a) => ({
		label: tk(`statblock.ability.${a}`),
		score: sb.scores[a] !== undefined ? fmt(sb.scores[a]) : none,
		mod: d.mods[a] !== undefined ? signed(d.mods[a]) : none,
		save: d.saves[a] !== undefined ? signedValue(d.saves[a]) : none,
	}));
}

// ---------------------------------------------------------------- competencias y defensas

function skillNames(d: Derived): { name: string; value: string }[] {
	const collator = new Intl.Collator(currentLanguage());
	return Object.entries(d.skills)
		.map(([id, v]) => ({ name: tk(`statblock.skill.${id}`), value: signedValue(v) }))
		.sort((a, b) => collator.compare(a.name, b.name));
}


const damageList = (xs: string[]) => xs.map((x) => (known(DAMAGE_TYPES, x) ? tk(`statblock.damage.${x.toLowerCase()}`) : plainTags(x)));

function conditionName(x: string, catalog: ConditionCatalog): string {
	return conditionById(x.toLowerCase(), catalog, true)?.name ?? plainTags(x);
}

function sensesLine(sb: Statblock, d: Derived, metric: boolean): string {
	const senses = SENSES.filter((s) => sb.senses[s] !== undefined).map((s) => `${tk(`statblock.sense.${s}`)} ${distance(sb.senses[s] as NumOrText, metric)}`);
	const list = [...senses, ...sb.senses_other.map((s) => knownPhrases(s, SENSE_TEXT, "statblock.senseText"))].join(", ");
	const passive = d.passivePerception !== undefined ? tk("statblock.passivePerception", { n: val(d.passivePerception) }) : "";
	return list && passive ? `${list}; ${passive}` : list || passive;
}

function infoLines(sb: Statblock, d: Derived, opts: StatblockOptions): LabelValue[] {
	const lines: LabelValue[] = [];
	const add = (key: string, text: string) => {
		if (text) lines.push({ label: tk(key), value: text });
	};
	if (!sb.all_skills) add("statblock.skills", skillNames(d).map((s) => `${s.name} ${s.value}`).join(", "));
	add("statblock.vulnerabilities", damageList(sb.vulnerabilities).join(", "));
	add("statblock.resistances", damageList(sb.resistances).join(", "));
	const damage = damageList(sb.immunities).join(", ");
	const conditions = sb.condition_immunities.map((c) => conditionName(c, opts.catalog)).join(", ");
	add("statblock.immunities", damage && conditions ? `${damage}; ${conditions}` : damage || conditions);
	add("statblock.gear", sb.gear.map(plainTags).join(", "));
	add("statblock.senses", sensesLine(sb, d, opts.metric));
	add("statblock.languages", sb.languages.map(plainTags).join(", ") || tk("statblock.none"));
	const xp = d.xp === undefined ? "" : d.xpLair !== undefined ? tk("statblock.xpLair", { xp: val(d.xp), lair: val(d.xpLair) }) : val(d.xp);
	// «VD 10 (PX 5900, o 7200 en su guarida)»; sin VD, «PX 5900».
	if (sb.cr) add("statblock.cr", xp ? `${sb.cr} (${tk("statblock.xp")} ${xp})` : sb.cr);
	else add("statblock.xp", xp);
	return lines;
}

// ---------------------------------------------------------------- rasgos y acciones

/** Separa el paréntesis propio del nombre («Fell Glare (Fiend Only)» → «Fell Glare», «Fiend Only»). */
function splitName(name: string): { base: string; own: string } {
	const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
	return m ? { base: m[1], own: m[2] } : { base: name, own: "" };
}

function usesText(e: StatEntry): string {
	if (!e.uses) return "";
	const per = e.uses_per === "short" ? "statblock.usesShort" : e.uses_per === "long" ? "statblock.usesLong" : "statblock.usesDay";
	const uses = tk(per, { n: e.uses });
	return e.uses_lair ? tk("statblock.usesLair", { uses, lair: tk(per, { n: e.uses_lair }) }) : uses;
}

function rechargeText(e: StatEntry): string {
	const r = e.recharge;
	if (r === undefined) return "";
	if (r === "short") return tk("statblock.rechargeShort");
	if (r === "long") return tk("statblock.rechargeLong");
	if (r === "short_or_long") return tk("statblock.rechargeShortOrLong");
	return r >= 6 ? tk("statblock.recharge6") : tk("statblock.recharge", { n: r });
}

/**
 * «***Nombre (2/día; …):***», en negrita y cursiva como en 2024 pero con dos puntos (decisión del
 * desarrollador), con el paréntesis generado y el propio del nombre juntos.
 */
function entryTitle(name: string, extra: string[]): string {
	const { base, own } = splitName(plainTags(name));
	const paren = [own, ...extra].filter(Boolean).join("; ");
	return `***${base}${paren ? ` (${paren})` : ""}:***`;
}

/** El título y el texto: el primer párrafo va en la misma línea que el título. */
function entryLines(title: string, text: string): string[] {
	const body = plainTags(text).trim();
	if (!body) return [title];
	const [first, ...rest] = body.split("\n");
	return [`${title} ${first}`, ...rest];
}

function entryBlock(e: StatEntry): string[] {
	return entryLines(entryTitle(e.name, [usesText(e), rechargeText(e)]), e.text);
}

function spellList(spells: string[]): string {
	return spells.map((s) => `*${plainTags(s).trim()}*`).join(", ");
}

function spellcastingBlock(b: SpellcastingBlock, d: Derived): string[] {
	const use = b.use === "action" || b.use === "trait" ? "" : tk(`statblock.use.${b.use}`);
	const lines = entryLines(entryTitle(b.name || tk("statblock.spellcastingName"), [use]), b.text);
	const mod = b.ability ? d.mods[b.ability] : undefined;
	if (mod !== undefined && d.pbNum !== undefined) lines.push(tk("statblock.spellDc", { dc: 8 + d.pbNum + mod, attack: signed(d.pbNum + mod) }));
	if (b.at_will.length) lines.push(`**${tk("statblock.atWill")}:** ${spellList(b.at_will)}`);
	for (const p of b.per_day) lines.push(`**${tk(p.each ? "statblock.perDayEach" : "statblock.usesDay", { n: p.uses })}:** ${spellList(p.spells)}`);
	for (const l of b.levels) {
		const label =
			l.level === 0
				? tk("statblock.cantrips")
				: l.slots !== undefined
					? T("statblock.levelSlots", { level: l.level, count: l.slots })
					: tk("statblock.level", { level: l.level });
		lines.push(`**${label}:** ${spellList(l.spells)}`);
	}
	if (b.footer.trim()) lines.push(...plainTags(b.footer).trim().split("\n"));
	return lines;
}

/** Cómo se refiere el texto a la criatura: «el aboleth», «Strahd». */
export function creatureRef(sb: Statblock): string {
	if (sb.named) return sb.name;
	const short = sb.short_name || sb.name.toLowerCase();
	const articles = tk("statblock.articles").split("|");
	const first = short.split(/\s+/)[0].toLowerCase();
	return articles.includes(first) ? short : tk("statblock.theCreature", { name: short });
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(currentLanguage()) + s.slice(1);

export function legendaryIntro(sb: Statblock): string {
	if (sb.legendary_header) return plainTags(sb.legendary_header);
	const ref = creatureRef(sb);
	const uses =
		sb.legendary_uses === undefined
			? ""
			: sb.legendary_uses_lair
				? tk("statblock.legendaryUsesLair", { uses: sb.legendary_uses, lair: sb.legendary_uses_lair })
				: tk("statblock.legendaryUses", { uses: sb.legendary_uses });
	const intro = tk("statblock.legendaryIntro", { name: ref, Name: capitalize(ref) });
	return uses ? `${uses} ${intro}` : intro;
}

// ---------------------------------------------------------------- todo junto

/** Líneas seguidas con salto de línea forzado (dos espacios al final), aunque esté activo «Saltos de línea estrictos». */
const hardBreaks = (lines: string[]) => lines.map((l, i) => (i < lines.length - 1 ? `${l}  ` : l)).join("\n");

/** La maqueta completa de un statblock. */
export function statblockLayout(sb: Statblock, opts: StatblockOptions): StatblockLayout {
	const d = derive(sb, sb.all_skills);
	const sections: LayoutSection[] = [];
	const section = (key: string, entries: string[][], intro?: string) => {
		if (entries.length) sections.push({ title: tk(key), ...(intro ? { intro } : {}), entries: entries.map(hardBreaks) });
	};
	const entries = (s: EntrySection) => sb.entries[s].map(entryBlock);
	section("statblock.section.traits", entries("traits"));
	section("statblock.section.spellcasting", sb.spellcasting.map((b) => spellcastingBlock(b, d)));
	section("statblock.section.actions", entries("actions"));
	section("statblock.section.bonus_actions", entries("bonus_actions"));
	section("statblock.section.reactions", entries("reactions"));
	section("statblock.section.legendary_actions", entries("legendary_actions"), sb.entries.legendary_actions.length ? legendaryIntro(sb) : undefined);
	section("statblock.section.mythic_actions", entries("mythic_actions"), sb.mythic_header ? plainTags(sb.mythic_header) : undefined);
	return {
		name: sb.name,
		subtitle: headerLine(sb),
		top: topBlock(sb, d),
		speed: speedLine(sb, opts.metric),
		abilities: abilityCells(sb, d),
		allSkills: sb.all_skills ? skillNames(d).map((x) => ({ label: x.name, value: x.value })) : null,
		lines: infoLines(sb, d, opts),
		sections,
	};
}
