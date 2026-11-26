import { contentLanguage, TC, TranslationKey, translationsOf } from "../i18n";
import en from "../i18n/locales/en.json";
import { allConditions, ConditionCatalog, conditionById } from "../initiative/conditions";
import { derive, Derived, signed, signedValue } from "./compute";
import { UseRef } from "./uses";
import { shows, StatblockItem, StatblockPreset } from "./presets";
import { fillNameTags } from "./nameTags";
import {
	ABILITIES,
	Ability,
	CREATURE_TYPES,
	DAMAGE_TYPES,
	ENTRY_SECTIONS,
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
	/** Qué se muestra y en qué orden, y los metros (`presets.ts`). */
	preset: StatblockPreset;
	/** Para dar el nombre traducido de las inmunidades a condiciones del SRD. */
	catalog: ConditionCatalog;
}

/** Textos de contenido: en el idioma del contenido (ajuste «Traducir el contenido»). */
const tk = (key: string, vars?: Record<string, string | number | null | undefined>) => TC(key as TranslationKey, vars);
/** Números del contenido: separador decimal del idioma del contenido y **sin separador de miles** («5900», «75000»; pedido del desarrollador). */
const fmt = (n: number) => n.toLocaleString(contentLanguage(), { maximumFractionDigits: 2, useGrouping: false });
/** Valor a mano o calculado: un número con el formato del idioma, o el texto tal cual. */
const val = (v: NumOrText) => (typeof v === "number" ? fmt(v) : v);
const known = (list: readonly string[], id: string) => list.includes(id.toLowerCase());

type ListFormatCtor = new (lang: string, o: { type: "conjunction" | "disjunction" }) => { format(items: string[]): string };
const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
/** «A, B o C» al estilo del idioma. */
function listOr(items: string[]): string {
	return ListFormat ? new ListFormat(contentLanguage(), { type: "disjunction" }).format(items) : items.join(", ");
}

/** ¿Es una marca de enlace? (las demás son de los bestiarios: su texto va en la tercera parte). */
const isLinkTag = (tag: string) => /^(condition|creature|spell)$/i.test(tag);

/**
 * Las marcas que queden en un texto: solo su texto (para nombres y conjuros de las listas). En las de enlace
 * el texto es la segunda parte (nombre|texto|libro); en las demás, que solo pueden venir de pegar texto de
 * un bestiario, la tercera (nombre|libro|texto).
 */
export function plainTags(text: string): string {
	return text.replace(/\{@(\w+)\s+([^{}]*)\}/g, (_all, tag: string, inner: string) => {
		const parts = inner.split("|");
		return ((isLinkTag(tag) ? parts[1] : parts[2]) || parts[0]).trim();
	});
}

/**
 * Como `plainTags`, pero **conserva las marcas de enlace** (`{@condition}`, `{@creature}`, `{@spell}`): el
 * dibujo las convierte en enlaces (paso 6). Para los textos de rasgos, acciones,
 * introducciones y líneas.
 */
export function keepLinks(text: string): string {
	return text.replace(/\{@(\w+)\s+([^{}]*)\}/g, (all, tag: string, inner: string) => {
		if (isLinkTag(tag)) return all;
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
	return keepLinks(text)
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

/**
 * Una distancia escrita como texto («30 ft., or 40 ft. (wolf form only)», «60 ft. (blind beyond this radius)»,
 * como las deja el importador): cada «N ft.» pasa a la distancia del idioma (y a metros, si toca), el «or» entre
 * distancias se traduce y las frases conocidas entre paréntesis, también. Lo demás, tal cual.
 */
function distanceText(text: string, metric: boolean): string {
	return text
		.replace(/(\d+(?:\.\d+)?)\s*ft\.?(?![\p{L}\d])/gu, (_all, n: string) => distance(Number(n), metric))
		.replace(/\bor\b(?=\s+\d)/g, tk("statblock.distanceOr"))
		.replace(/\(([^()]*)\)/g, (_all, inner: string) => `(${knownPhrases(inner, SENSE_TEXT, "statblock.senseText")})`);
}

function distance(v: NumOrText, metric: boolean): string {
	if (typeof v !== "number") return distanceText(v, metric);
	const feet = tk("statblock.feet", { n: fmt(v) });
	return metric ? `${feet} (${tk("statblock.meters", { n: fmt(Math.round(v * 3) / 10) })})` : feet;
}

/** «60 ft., Burrow 40 ft., Fly 80 ft. (hover)»: caminando primero y el resto por orden alfabético. */
export function speedLine(sb: Statblock, metric: boolean): string {
	const collator = new Intl.Collator(contentLanguage());
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
	/** Campo del formulario al que lleva un clic en la vista previa («ac», «senses»…). */
	field?: string;
}

/** Una línea «**Etiqueta** valor» (Habilidades… Idiomas, Desafío), con la parte del statblock que es. */
export interface LayoutLine extends LabelValue {
	item: StatblockItem;
}

/** Una característica: abreviatura, puntuación, modificador y salvación («—» si falta). */
export interface AbilityCell {
	ability: Ability;
	label: string;
	score: string;
	mod: string;
	save: string;
}

/** Una sección (Rasgos, Acciones…): título, introducción opcional (Markdown) y entradas (Markdown). */
/**
 * Casillas de usos (paso 4): `total` casillas, las `used` primeras marcadas. Desde `lairFrom`, solo en
 * la guarida («3/día, o 4/día en su guarida»: 4 casillas, la cuarta de guarida). `recharge`: la única
 * casilla de una recarga («gastada»). `ref`: dónde se guarda.
 */
export interface Boxes {
	total: number;
	used: number;
	lairFrom?: number;
	recharge?: boolean;
	ref: UseRef;
}

/** Una línea de una lista de conjuros: «**1/día cada uno:** *Bola de fuego* ☐, *Volar* ☐». */
export interface SpellLine {
	/** Campo del formulario: «spell:0:atWill», «spell:0:perDay:1», «spell:0:level:2». */
	target: string;
	label: string;
	/** Cada conjuro: su nombre (en cursiva), la nota de detrás (texto normal, con espacios) y sus casillas. */
	spells: { name: string; note?: string; boxes?: Boxes }[];
	/** Casillas de la lista entera (al día sin «cada uno», o los espacios de un nivel), tras la etiqueta. */
	boxes?: Boxes;
}

/** Una entrada: Markdown (con el nombre al principio) y, si las tiene, sus casillas tras el nombre. */
export interface LayoutEntry {
	/** Campo del formulario al que lleva un clic en la vista previa («entry:actions:2», «spell:0»). */
	target: string;
	markdown: string;
	boxes?: Boxes;
	/** Bloques de conjuros: la CD y el ataque, las listas y el texto final (Markdown). */
	spell?: { stats?: LabelValue[]; lines: SpellLine[]; footer?: string };
}

export interface LayoutSection {
	/** «traits», «spellcasting», «actions»… (para llevar a su sección del formulario). */
	key: string;
	title: string;
	intro?: string;
	entries: LayoutEntry[];
	/** Casillas tras el título (los usos de acción legendaria). */
	boxes?: Boxes;
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
	/** ¿Fila de salvaciones en la tabla de características? (se puede ocultar en el preset). */
	saves: boolean;
	/** Con «Mostrar todas las habilidades», la tabla de las 18 (si no, null y van en una línea). */
	allSkills: LabelValue[] | null;
	/** Líneas «**Etiqueta** valor»: Habilidades… Idiomas y el Desafío (VD y PX). */
	lines: LayoutLine[];
	sections: LayoutSection[];
	/** Orden de las partes (las ocultas del preset, fuera). Las que no tienen nada no se dibujan. */
	order: StatblockItem[];
}

function topBlock(sb: Statblock, d: Derived, preset: StatblockPreset): (LabelValue | null)[][] {
	const cellOf = (key: string, value: string | undefined): LabelValue | null => (value ? { label: tk(key), value, field: key.replace("statblock.", "") } : null);
	const ac = sb.ac !== undefined ? `${val(sb.ac)}${sb.ac_note ? ` (${knownPhrases(sb.ac_note, ARMOR, "statblock.armor")})` : ""}` : undefined;
	const init = d.initiative === undefined || !shows(preset, "initiative") ? undefined : typeof d.initiative === "number" ? `${signed(d.initiative)} (${10 + d.initiative})` : d.initiative;
	const hp = d.hp !== undefined ? `${val(d.hp)}${sb.hp_formula ? ` (${sb.hp_formula})` : ""}` : sb.hp_formula ? `(${sb.hp_formula})` : undefined;
	const pb = d.pb !== undefined && shows(preset, "pb") ? signedValue(d.pb) : undefined;
	return [
		[cellOf("statblock.ac", ac), cellOf("statblock.initiative", init)],
		[cellOf("statblock.hp", hp), cellOf("statblock.pb", pb)],
	].filter((r) => r.some(Boolean));
}

function abilityCells(sb: Statblock, d: Derived): AbilityCell[] | null {
	if (!ABILITIES.some((a) => sb.scores[a] !== undefined || sb.saves[a] !== undefined)) return null;
	const none = tk("statblock.none");
	return ABILITIES.map((a) => ({
		ability: a,
		label: tk(`statblock.ability.${a}`),
		score: sb.scores[a] !== undefined ? fmt(sb.scores[a]) : none,
		mod: d.mods[a] !== undefined ? signed(d.mods[a]) : none,
		save: d.saves[a] !== undefined ? signedValue(d.saves[a]) : none,
	}));
}

// ---------------------------------------------------------------- competencias y defensas

function skillNames(d: Derived): { name: string; value: string }[] {
	const collator = new Intl.Collator(contentLanguage());
	return Object.entries(d.skills)
		.map(([id, v]) => ({ name: tk(`statblock.skill.${id}`), value: signedValue(v) }))
		.sort((a, b) => collator.compare(a.name, b.name));
}


const damageList = (xs: string[]) => xs.map((x) => (known(DAMAGE_TYPES, x) ? tk(`statblock.damage.${x.toLowerCase()}`) : keepLinks(x)));

function conditionName(x: string, catalog: ConditionCatalog): string {
	// Como enlace a su ficha (§10.1-4), con su nombre en el idioma del contenido.
	const info = conditionById(x.toLowerCase(), catalog, true) ?? allConditions(catalog, { includeHidden: true }).find((c) => c.custom && c.name === x);
	return info ? `{@condition ${info.custom ? info.name : info.id}|${info.name}}` : keepLinks(x);
}

function sensesLine(sb: Statblock, d: Derived, metric: boolean, passivePerception: boolean): string {
	const senses = SENSES.filter((s) => sb.senses[s] !== undefined).map((s) => `${tk(`statblock.sense.${s}`)} ${distance(sb.senses[s] as NumOrText, metric)}`);
	const list = [...senses, ...sb.senses_other.map((s) => knownPhrases(s, SENSE_TEXT, "statblock.senseText"))].join(", ");
	const passive = d.passivePerception !== undefined && passivePerception ? tk("statblock.passivePerception", { n: val(d.passivePerception) }) : "";
	return list && passive ? `${list}; ${passive}` : list || passive;
}

function infoLines(sb: Statblock, d: Derived, opts: StatblockOptions): LayoutLine[] {
	const p = opts.preset;
	const lines: LayoutLine[] = [];
	const add = (item: StatblockItem, key: string, text: string) => {
		if (text) lines.push({ item, label: tk(key), value: text, field: key.replace("statblock.", "") });
	};
	if (!sb.all_skills) add("skills", "statblock.skills", skillNames(d).map((s) => `${s.name} ${s.value}`).join(", "));
	add("vulnerabilities", "statblock.vulnerabilities", damageList(sb.vulnerabilities).join(", "));
	add("resistances", "statblock.resistances", damageList(sb.resistances).join(", "));
	const damage = damageList(sb.immunities).join(", ");
	const conditions = sb.condition_immunities.map((c) => conditionName(c, opts.catalog)).join(", ");
	add("immunities", "statblock.immunities", damage && conditions ? `${damage}; ${conditions}` : damage || conditions);
	add("gear", "statblock.gear", sb.gear.map(keepLinks).join(", "));
	add("senses", "statblock.senses", sensesLine(sb, d, p.metric, shows(p, "passive_perception")));
	add("languages", "statblock.languages", sb.languages.map(keepLinks).join(", ") || tk("statblock.none"));
	const lair = d.xpLair !== undefined && shows(p, "xp_lair");
	const xp = d.xp === undefined || !shows(p, "xp") ? "" : lair ? tk("statblock.xpLair", { xp: val(d.xp), lair: val(d.xpLair as NumOrText) }) : val(d.xp);
	// «VD 10 (PX 5900, o 7200 en su guarida)»; sin VD (o con el VD oculto), «PX 5900».
	if (sb.cr && shows(p, "cr")) add("challenge", "statblock.cr", xp ? `${sb.cr} (${tk("statblock.xp")} ${xp})` : sb.cr);
	else add("challenge", "statblock.xp", xp);
	return lines;
}

// ---------------------------------------------------------------- rasgos y acciones

/** Separa el paréntesis propio del nombre («Fell Glare (Fiend Only)» → «Fell Glare», «Fiend Only»). */
function splitName(name: string): { base: string; own: string } {
	const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
	return m ? { base: m[1], own: m[2] } : { base: name, own: "" };
}

/** Lo que tienen en común una entrada y un bloque de conjuros para sus usos y casillas. */
type UsesFields = Pick<StatEntry, "uses" | "uses_lair" | "uses_per" | "recharge" | "used">;

function usesText(e: UsesFields): string {
	if (!e.uses) return "";
	const per = e.uses_per === "short" ? "statblock.usesShort" : e.uses_per === "long" ? "statblock.usesLong" : "statblock.usesDay";
	const uses = tk(per, { n: e.uses });
	return e.uses_lair ? tk("statblock.usesLair", { uses, lair: tk(per, { n: e.uses_lair }) }) : uses;
}

function rechargeText(e: UsesFields): string {
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
	const body = keepLinks(text).trim();
	if (!body) return [title];
	const [first, ...rest] = body.split("\n");
	return [`${title} ${first}`, ...rest];
}

/**
 * Casillas de una entrada: una por uso (y las de la guarida, aparte) o, si no tiene usos pero sí recarga,
 * una sola. Lo gastado nunca pasa del total (si se bajaron los usos).
 */
function entryBoxes(e: StatEntry, section: EntrySection): Boxes | undefined {
	return usesBoxes(e, { kind: "entry", section, index: e.index });
}

function usesBoxes(e: UsesFields, ref: UseRef): Boxes | undefined {
	if (e.uses) {
		const total = Math.max(e.uses, e.uses_lair ?? 0);
		return { total, used: Math.min(e.used, total), ...(total > e.uses ? { lairFrom: e.uses } : {}), ref };
	}
	if (e.recharge !== undefined) return { total: 1, used: Math.min(e.used, 1), recharge: true, ref };
	return undefined;
}

function entryBlock(e: StatEntry, section: EntrySection): LayoutEntry {
	const boxes = entryBoxes(e, section);
	// Sin nombre (y sin usos ni recarga, que van en el paréntesis del nombre): solo el texto. En las
	// acciones de guarida, como en el libro, en viñeta.
	const plain = !e.name.trim() && !boxes;
	const text = keepLinks(e.text).trim();
	const markdown = plain ? (section === "lair_actions" ? `- ${text}` : text) : hardBreaks(entryLines(entryTitle(e.name, [usesText(e), rechargeText(e)]), e.text));
	return { target: `entry:${section}:${e.index}`, markdown, ...(boxes ? { boxes } : {}) };
}

/**
 * Un conjuro de una lista: su nombre y, si la tiene, la nota de detrás («{@spell Invisibility} (self only)»,
 * «{@spell Mage Armor}*»). La nota conserva sus espacios iniciales («*» va pegado, « (…)» con espacio) y sus
 * marcas de enlace. Sin marca al principio (escritos a mano antes del 2026-11-26), el nombre es lo que va antes
 * del primer «(» o «*».
 */
export function splitSpellItem(item: string): { name: string; note: string } {
	const s = item.trim();
	const tag = /^\{@\w+\s+[^{}]*\}/.exec(s);
	// Sin marca: hasta el primer «(» o «*», con los espacios de antes en la nota.
	const at = s.search(/[*(]/);
	const cut = tag ? tag[0].length : at > 0 ? s.slice(0, at).trimEnd().length : s.length;
	return { name: plainTags(s.slice(0, cut)).trim(), note: keepLinks(s.slice(cut)).trimEnd() };
}

/**
 * Lo que se escribe en una lista de conjuros del formulario, para guardarlo (pedido del desarrollador,
 * 2026-11-26): el nombre va en una marca de conjuro y la nota de detrás («(…)» o «*») queda fuera
 * («Armadura de Mago (antes del combate)» → «{@spell Armadura de Mago} (antes del combate)»). Si ya lleva
 * alguna marca `{@`, se guarda tal cual: así se puede escribir cualquier otra cosa.
 */
export function spellItemFromInput(text: string): string {
	const t = text.trim();
	if (!t || t.includes("{@")) return t;
	const at = t.search(/[*(]/);
	const name = (at < 0 ? t : t.slice(0, at)).trim();
	if (!name) return t;
	const rest = at < 0 ? "" : t.slice(at).trim();
	return `{@spell ${name}}${rest ? (rest.startsWith("*") ? rest : ` ${rest}`) : ""}`;
}

/** Cómo se ve un conjuro de una lista en el formulario: sin marcas («Armadura de Mago (antes del combate)»). */
export function spellItemLabel(item: string): string {
	const { name, note } = splitSpellItem(item);
	return `${name}${plainTags(note)}`;
}

/** Un conjuro de una lista para la maqueta: nombre y, si la tiene, su nota. */
const spellEntry = (s: string): { name: string; note?: string } => {
	const { name, note } = splitSpellItem(s);
	return note ? { name, note } : { name };
};

function spellcastingBlock(b: SpellcastingBlock, d: Derived): LayoutEntry {
	// Usos y recarga del bloque entero («Protective Magic (3/día)»), con sus casillas tras el nombre.
	const markdown = hardBreaks(entryLines(entryTitle(b.name || tk("statblock.spellcastingName"), [usesText(b), rechargeText(b)]), b.text));
	const boxes = usesBoxes(b, { kind: "block", block: b.index });
	const mod = b.ability ? d.mods[b.ability] : undefined;
	// «CD de salvación de conjuros 14 | Bonificador de ataque con conjuros +6», como CA e Iniciativa. Se puede
	// ocultar en un bloque (`hide_dc`): p. ej. si es la misma que la del bloque principal.
	const stats: LabelValue[] | undefined =
		!b.hide_dc && mod !== undefined && d.pbNum !== undefined
			? [
					{ label: tk("statblock.spellSaveDc"), value: String(8 + d.pbNum + mod) },
					{ label: tk("statblock.spellAttack"), value: signed(d.pbNum + mod) },
				]
			: undefined;
	const lines: SpellLine[] = [];
	const target = `spell:${b.index}`;
	if (b.at_will.length) lines.push({ target: `${target}:atWill`, label: tk("statblock.atWill"), spells: b.at_will.map(spellEntry) });
	for (const p of b.per_day) {
		const ref = { kind: "perDay" as const, block: b.index, index: p.index };
		const label = tk(p.each ? "statblock.perDayEach" : "statblock.usesDay", { n: p.uses });
		const lineTarget = `${target}:perDay:${p.index}`;
		if (p.each)
			lines.push({
				target: lineTarget,
				label,
				spells: p.spells.map((s) => {
					const e = spellEntry(s);
					return { ...e, boxes: { total: p.uses, used: Math.min(p.usedEach[e.name] ?? 0, p.uses), ref: { ...ref, spell: e.name } } };
				}),
			});
		else lines.push({ target: lineTarget, label, spells: p.spells.map(spellEntry), boxes: { total: p.uses, used: Math.min(p.used, p.uses), ref } });
	}
	for (const l of b.levels) {
		const label =
			l.level === 0
				? tk("statblock.cantrips")
				: l.slots !== undefined
					? TC("statblock.levelSlots", { level: l.level, count: l.slots })
					: tk("statblock.level", { level: l.level });
		const slots = l.level > 0 && l.slots ? { total: l.slots, used: Math.min(l.used, l.slots), ref: { kind: "level" as const, block: b.index, index: l.index } } : undefined;
		lines.push({ target: `${target}:level:${l.index}`, label, spells: l.spells.map(spellEntry), ...(slots ? { boxes: slots } : {}) });
	}
	const footer = keepLinks(b.footer).trim();
	return { target, markdown, ...(boxes ? { boxes } : {}), spell: { ...(stats ? { stats } : {}), lines, ...(footer ? { footer } : {}) } };
}

/** ¿Tiene el statblock alguna casilla? (para el botón «Restablecer usos»). */
export function hasBoxes(layout: StatblockLayout): boolean {
	return layout.sections.some(
		(s) =>
			s.boxes ||
			s.entries.some((e) => e.boxes || e.spell?.lines.some((l) => l.boxes || l.spells.some((x) => x.boxes))),
	);
}

/**
 * Cómo se refiere el texto a la criatura («el aboleth», «the dragon», «Strahd»): el «Nombre en el texto»
 * (`short_name`) o, si está vacío, el nombre en minúsculas con el artículo del idioma del contenido. Si
 * `short_name` ya empieza por un artículo de **cualquier** idioma, se deja tal cual: lo importado lo trae
 * con el del idioma de sus textos («the lich» en un bestiario en inglés, «la saga» en uno en español).
 */
export function creatureRef(sb: Statblock): string {
	if (sb.named) return sb.short_name || sb.name;
	const short = sb.short_name || sb.name.toLowerCase();
	const articles = translationsOf("statblock.articles").flatMap((a) => a.split("|"));
	const first = short.split(/\s+/)[0].toLowerCase();
	return articles.includes(first) ? short : tk("statblock.theCreature", { name: short });
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(contentLanguage()) + s.slice(1);

/** El statblock con las marcas `{@name}`/`{@Name}` de sus textos cambiadas por `creatureRef` (`nameTags.ts`). */
function withNames(sb: Statblock): Statblock {
	const ref = creatureRef(sb);
	const fill = (t: string) => fillNameTags(t, ref, capitalize);
	const entries = { ...sb.entries };
	for (const s of ENTRY_SECTIONS) entries[s] = sb.entries[s].map((e) => ({ ...e, text: fill(e.text) }));
	return {
		...sb,
		entries,
		spellcasting: sb.spellcasting.map((b) => ({ ...b, text: fill(b.text), footer: fill(b.footer) })),
		legendary_header: fill(sb.legendary_header),
		lair_actions_header: fill(sb.lair_actions_header),
	};
}

/** Usos de acción legendaria por defecto, si `legendary_uses` está vacío (el valor habitual; pedido del desarrollador). */
export const DEFAULT_LEGENDARY_USES = 3;

export function legendaryIntro(sb: Statblock): string {
	if (sb.legendary_header) return keepLinks(sb.legendary_header);
	const ref = creatureRef(sb);
	const n = sb.legendary_uses ?? DEFAULT_LEGENDARY_USES;
	const uses =
		sb.legendary_uses_lair && sb.legendary_uses_lair !== n
			? tk("statblock.legendaryUsesLair", { uses: n, lair: sb.legendary_uses_lair })
			: tk("statblock.legendaryUses", { uses: n });
	return `${uses} ${tk("statblock.legendaryIntro", { name: ref, Name: capitalize(ref) })}`;
}

// ---------------------------------------------------------------- todo junto

/** Líneas seguidas con salto de línea forzado (dos espacios al final), aunque esté activo «Saltos de línea estrictos». */
const hardBreaks = (lines: string[]) => lines.map((l, i) => (i < lines.length - 1 ? `${l}  ` : l)).join("\n");

/** La maqueta completa de un statblock. */
export function statblockLayout(source: Statblock, opts: StatblockOptions): StatblockLayout {
	const sb = withNames(source);
	const d = derive(sb, sb.all_skills);
	const sections: LayoutSection[] = [];
	const section = (key: string, entries: LayoutEntry[], intro?: string, boxes?: Boxes) => {
		if (entries.length) sections.push({ key: key.replace("statblock.section.", ""), title: tk(key), ...(intro ? { intro } : {}), entries, ...(boxes ? { boxes } : {}) });
	};
	// Usos de acción legendaria: una casilla por uso (las de más en la guarida, aparte).
	const legendaryUses = sb.legendary_uses ?? DEFAULT_LEGENDARY_USES;
	const legendaryTotal = Math.max(legendaryUses, sb.legendary_uses_lair ?? 0);
	const legendaryBoxes: Boxes = {
		total: legendaryTotal,
		used: Math.min(sb.legendary_used, legendaryTotal),
		...(legendaryTotal > legendaryUses ? { lairFrom: legendaryUses } : {}),
		ref: { kind: "legendary" },
	};
	const entries = (s: EntrySection) => sb.entries[s].map((e) => entryBlock(e, s));
	section("statblock.section.traits", entries("traits"));
	section("statblock.section.spellcasting", sb.spellcasting.map((b) => spellcastingBlock(b, d)));
	section("statblock.section.actions", entries("actions"));
	section("statblock.section.bonus_actions", entries("bonus_actions"));
	section("statblock.section.reactions", entries("reactions"));
	const legendaryText = sb.entries.legendary_actions.length && shows(opts.preset, "legendary_header") ? legendaryIntro(sb) : undefined;
	section("statblock.section.legendary_actions", entries("legendary_actions"), legendaryText, legendaryBoxes);
	section("statblock.section.lair_actions", entries("lair_actions"), sb.lair_actions_header ? keepLinks(sb.lair_actions_header) : undefined);
	return {
		name: sb.name,
		subtitle: headerLine(sb),
		top: topBlock(sb, d, opts.preset),
		speed: speedLine(sb, opts.preset.metric),
		abilities: abilityCells(sb, d),
		saves: shows(opts.preset, "saves"),
		allSkills: sb.all_skills ? skillNames(d).map((x) => ({ label: x.name, value: x.value })) : null,
		lines: infoLines(sb, d, opts),
		sections,
		// Equipo, Sentidos e Idiomas se pueden ocultar enteros.
		order: opts.preset.order.filter((item) => !(item === "gear" || item === "senses" || item === "languages") || shows(opts.preset, item)),
	};
}
