import { abilityMod, averageHp, pbForCr, xpForCr } from "./compute";
import { ABILITIES, SKILLS } from "./data";

/**
 * Importar statblocks (1.4, paso 5): convierte una criatura en el formato JSON de 5etools en las
 * propiedades de una nota de statblock y el texto de su cuerpo. Sin DOM ni Obsidian (se prueba en los
 * tests). La interfaz y el README no nombran 5etools (decisión del desarrollador).
 *
 * Decisiones (docs/hoja-de-ruta.md, 1.4, «PARA RETOMAR», paso 5, y §10.1):
 *  - las marcas `{@…}` se convierten al texto de 2024 con su cursiva; solo se conservan `{@condition}`,
 *    `{@creature}` y `{@spell}`, sin la fuente;
 *  - usos y recargas del nombre, a sus campos;
 *  - lo calculado (PG medios, salvaciones, habilidades, pasiva, PX) se deja vacío si coincide;
 *  - conjuros: bloque principal; los bloques de un solo conjuro se juntan con él (a su lista al día o a
 *    una línea nueva, descartando su texto) salvo los de uso legendario, con recarga o de criaturas sin
 *    bloque principal, que pasan a ser una entrada de la sección de su `displayAs`; los de varios conjuros
 *    con usos compartidos se quedan como bloque propio;
 *  - acciones de guarida (del grupo legendario) a su sección; efectos regionales y variantes de 2014, al
 *    cuerpo de la nota; `_versions` no se importan.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Libros de 2024 (sus criaturas son `dnd5e-2024`); el resto, `dnd5e-2014`. */
const SOURCES_2024 = new Set(["XMM", "XPHB", "XDMG"]);

/** Etiqueta del libro para distinguir notas con el mismo nombre («ST-Aboleth (MM'14)»; decisión del desarrollador). */
export function bookLabel(source: string): string {
	return ({ MM: "MM'14", XMM: "MM'24", XPHB: "PHB'24", XDMG: "DMG'24" } as Record<string, string>)[source] ?? source;
}

// ================================================================ marcas {@…}

const ABILITY_NAMES: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const ATK: Record<string, string> = {
	mw: "Melee Weapon Attack",
	rw: "Ranged Weapon Attack",
	"mw,rw": "Melee or Ranged Weapon Attack",
	ms: "Melee Spell Attack",
	rs: "Ranged Spell Attack",
	"ms,rs": "Melee or Ranged Spell Attack",
	m: "Melee Attack",
	r: "Ranged Attack",
};
const ATKR: Record<string, string> = { m: "Melee Attack Roll", r: "Ranged Attack Roll", "m,r": "Melee or Ranged Attack Roll" };
/** Las que se conservan (enlaces, paso 6). */
const KEEP = new Set(["condition", "creature", "spell"]);

/** Escapa lo que Markdown interpretaría en un texto suelto (fuera de las marcas). */
function escapeMarkdown(s: string): string {
	return s.replace(/([*_[\]\\`])/g, "\\$1").replace(/^(\s*)(\d+)\. /, "$1$2\\. ");
}

/** El texto de una marca. `parts` = sus partes separadas por `|`. */
function renderTag(tag: string, body: string): string {
	const parts = body.split("|");
	const p = (i: number) => (parts[i] ?? "").trim();
	const display = p(2) || p(0);
	switch (tag) {
		case "condition":
		case "creature":
		case "spell":
			// Sin la fuente; con el texto a mostrar solo si es distinto del nombre.
			return p(2) && p(2) !== p(0) ? `{@${tag} ${p(0)}||${p(2)}}` : `{@${tag} ${p(0)}}`;
		case "h":
			return "*Hit:* ";
		case "hom":
			return "*Hit or Miss:* ";
		case "atk":
			return `*${ATK[p(0).replace(/\s/g, "")] ?? "Attack"}:*`;
		case "atkr":
			return `*${ATKR[p(0).replace(/\s/g, "")] ?? "Attack Roll"}:*`;
		case "hit": {
			const n = Number(p(0));
			return Number.isFinite(n) ? (n < 0 ? `\u2212${Math.abs(n)}` : `+${n}`) : p(0);
		}
		case "dc":
			return `DC ${p(0)}`;
		case "damage":
		case "dice":
			return (p(1) || p(0)).replace(/summonSpellLevel/g, "the spell's level");
		case "actSave":
			return `*${ABILITY_NAMES[p(0).toLowerCase()] ?? p(0)} Saving Throw:*`;
		case "actSaveFail":
			return p(0) === "1" ? "*First Failure:*" : p(0) === "2" ? "*Second Failure:*" : "*Failure:*";
		case "actSaveSuccess":
			return "*Success:*";
		case "actSaveSuccessOrFail":
			return "*Failure or Success:*";
		case "actSaveFailBy":
			return `*Failure by ${p(0)} or More:*`;
		case "actTrigger":
			return "*Trigger:*";
		case "actResponse":
			return p(0) === "d" ? "*Response\u2014*" : "*Response:*";
		case "recharge":
			return p(0) && p(0) !== "6" ? `(Recharge ${p(0)}\u20136)` : "(Recharge 6)";
		case "chance":
			return p(1) || `${p(0)} percent`;
		case "quickref":
			return p(4) || p(0);
		case "note":
			return `*${body}*`;
		case "b":
		case "bold":
			return `**${body}**`;
		case "i":
		case "italic":
			return `*${body}*`;
		default:
			// variantrule, item, status, action, skill, sense, hazard, book, table, adventure, hitYourSpellAttack…
			return display;
	}
}

/**
 * Convierte las marcas de un texto (de dentro afuera, por si van anidadas) y escapa el Markdown del texto
 * suelto. `{@condition}`, `{@creature}` y `{@spell}` se conservan sin la fuente.
 */
export function convertText(text: string): string {
	const keep: string[] = [];
	let s = text;
	// Las marcas convertidas se guardan aparte y se dejan como marcadores, para no escapar su Markdown.
	const holder = (out: string) => {
		keep.push(out);
		return `\uE000${keep.length - 1}\uE000`;
	};
	for (let guard = 0; guard < 20; guard++) {
		let changed = false;
		s = s.replace(/\{@(\w+)(?:\s([^{}]*))?\}/g, (_all, tag: string, body: string | undefined) => {
			changed = true;
			const inner = (body ?? "").replace(/\uE000(\d+)\uE000/g, (_m, i: string) => keep[Number(i)]);
			return holder(renderTag(tag, inner));
		});
		if (!changed) break;
	}
	const escaped = s
		.split(/(\uE000\d+\uE000)/)
		.map((part) => (/^\uE000\d+\uE000$/.test(part) ? part : escapeMarkdown(part)))
		.join("");
	return escaped.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => keep[Number(i)]);
}

/** Texto plano de una marca o una lista (para campos cortos: notas de armadura, sentidos…): sin Markdown. */
export function plainText(text: string): string {
	let s = text;
	for (let guard = 0; guard < 20; guard++) {
		const next = s.replace(/\{@(\w+)(?:\s([^{}]*))?\}/g, (_a, tag: string, body: string | undefined) => {
			const out = renderTag(tag, body ?? "");
			return KEEP.has(tag) ? (body ?? "").split("|")[2] || (body ?? "").split("|")[0] : out.replace(/\*/g, "");
		});
		if (next === s) break;
		s = next;
	}
	return s.trim();
}

// ================================================================ entradas → Markdown

/** Convierte una lista de entradas de 5etools (textos, listas, subapartados, tablas…) en Markdown. */
export function entriesToMarkdown(entries: unknown, depth = 0): string {
	const blocks: string[] = [];
	for (const e of arr(entries)) {
		if (typeof e === "string") blocks.push(convertText(e));
		else if (isObj(e)) blocks.push(entryObjectToMarkdown(e, depth));
	}
	return blocks.filter(Boolean).join("\n\n");
}

function titled(name: string, body: string): string {
	return name ? `***${convertText(name)}.*** ${body}`.trim() : body;
}

function entryObjectToMarkdown(e: Obj, depth: number): string {
	const type = str(e.type);
	const name = str(e.name);
	if (type === "list") {
		const indent = "  ".repeat(Math.min(depth, 3));
		return arr(e.items)
			.map((it) => {
				if (typeof it === "string") return `${indent}- ${convertText(it)}`;
				if (!isObj(it)) return "";
				const body = it.entry !== undefined ? convertText(str(it.entry)) : entriesToMarkdown(it.entries, depth + 1).replace(/\n\n/g, " ");
				return `${indent}- ${titled(str(it.name), body)}`;
			})
			.filter(Boolean)
			.join("\n");
	}
	if (type === "table") {
		const head = arr(e.colLabels).map((c) => plainText(str(c)));
		const rows = arr(e.rows).map((r) => arr(r).map((c) => plainText(typeof c === "string" ? c : isObj(c) ? str(c.entry ?? c.text ?? "") : str(c)).replace(/\|/g, "\\|")));
		const width = Math.max(head.length, ...rows.map((r) => r.length));
		if (!width) return "";
		const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
		return [line(head.length ? head : Array<string>(width).fill("")), line(Array<string>(width).fill("---")), ...rows.map(line)].join("\n");
	}
	if (type === "spellcasting") {
		// Lanzamiento de conjuros dentro de una variante (2014): texto y listas, en Markdown.
		const lines = [entriesToMarkdown(e.headerEntries, depth)];
		if (Array.isArray(e.will) && e.will.length) lines.push(`**At will:** ${spellNames(e.will)}`);
		if (isObj(e.daily))
			for (const [k, list] of Object.entries(e.daily)) lines.push(`**${k.replace("e", "")}/day${k.endsWith("e") ? " each" : ""}:** ${spellNames(list)}`);
		lines.push(entriesToMarkdown(e.footerEntries, depth));
		return titled(name, lines.filter(Boolean).join("\n\n"));
	}
	// entries, item, itemSub, inset, variant, variantSub, inline… : su nombre (si lo tiene) y sus entradas.
	const body = e.entry !== undefined ? convertText(str(e.entry)) : entriesToMarkdown(e.entries, depth + 1);
	return titled(name, body);
}

const spellNames = (list: unknown) =>
	arr(list)
		.map((s) => `*${plainText(str(s))}*`)
		.join(", ");

// ================================================================ cabecera y defensa

const SIZE: Record<string, string> = { T: "tiny", S: "small", M: "medium", L: "large", H: "huge", G: "gargantuan" };

/** Alineamiento como frase en inglés («Lawful Evil», «Any Non-Good Alignment»…). */
export function alignmentPhrase(v: unknown): string {
	const list = arr(v);
	if (list.some(isObj))
		return list
			.filter(isObj)
			.map((o) => `${alignmentPhrase(o.alignment ?? o.special)}${o.chance ? ` (${str(o.chance)}%)` : ""}`)
			.join(" or ");
	const codes = new Set(list.map((x) => str(x).toUpperCase()));
	if (!codes.size) return "";
	if (codes.has("A")) return "Any Alignment";
	if (codes.has("U")) return "Unaligned";
	const lc = ["L", "NX", "C"].filter((c) => codes.has(c));
	const ge = ["G", "NY", "E"].filter((c) => codes.has(c));
	const word: Record<string, string> = { L: "Lawful", C: "Chaotic", G: "Good", E: "Evil", NX: "Neutral", NY: "Neutral", N: "Neutral" };
	if (lc.length === 3 && ge.length === 3) return "Any Alignment";
	if (lc.length === 3 && ge.length === 2) return `Any Non-${word[["G", "NY", "E"].find((c) => !codes.has(c)) ?? "G"]} Alignment`;
	if (ge.length === 3 && lc.length === 2) return `Any Non-${word[["L", "NX", "C"].find((c) => !codes.has(c)) ?? "L"]} Alignment`;
	if (ge.length === 3 && lc.length === 1) return `Any ${word[lc[0]]} Alignment`;
	if (lc.length === 3 && ge.length === 1) return `Any ${word[ge[0]]} Alignment`;
	const parts = [...codes].map((c) => word[c] ?? c);
	if (parts.length === 2 && parts[0] === "Neutral" && parts[1] === "Neutral") return "Neutral";
	return parts.join(" ");
}

function typeFields(t: unknown): { type: string[]; subtype: string[]; swarm?: string } {
	if (typeof t === "string") return { type: [t.toLowerCase()], subtype: [] };
	if (!isObj(t)) return { type: [], subtype: [] };
	const base = t.type;
	const type = isObj(base) && Array.isArray(base.choose) ? base.choose.map((x) => str(x).toLowerCase()) : [str(base).toLowerCase()].filter(Boolean);
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const subtype = arr(t.tags)
		.map((x) => (typeof x === "string" ? x : isObj(x) ? str(x.tag) : ""))
		.filter(Boolean)
		.map(cap);
	return { type, subtype, ...(t.swarmSize ? { swarm: SIZE[str(t.swarmSize)] } : {}) };
}

function acFields(ac: unknown): { ac?: number | string; ac_note?: string } {
	const list = arr(ac);
	if (!list.length) return {};
	const first = list[0];
	const notes: string[] = [];
	let value: number | string | undefined;
	if (typeof first === "number") value = first;
	else if (isObj(first)) {
		if (first.special !== undefined) value = plainText(str(first.special));
		else value = Number(first.ac);
		if (Array.isArray(first.from)) notes.push(first.from.map((x) => plainText(str(x))).join(", "));
		if (first.condition) notes.push(plainText(str(first.condition)));
	}
	// Las demás: CA alternativas («15 with mage armor», «11 while prone»).
	for (const x of list.slice(1)) {
		if (typeof x === "number") notes.push(String(x));
		else if (isObj(x)) notes.push([str(x.ac), x.from ? `(${arr(x.from).map((f) => plainText(str(f))).join(", ")})` : "", x.condition ? plainText(str(x.condition)) : ""].filter(Boolean).join(" "));
	}
	const note = notes.filter(Boolean).join(", ");
	return { ...(value !== undefined && value !== "" ? { ac: value } : {}), ...(note ? { ac_note: note } : {}) };
}

function hpFields(hp: unknown): { hp?: number | string; hp_formula?: string } {
	if (!isObj(hp)) return {};
	if (hp.special !== undefined) return { hp: plainText(str(hp.special)) };
	const formula = str(hp.formula).trim();
	const average = typeof hp.average === "number" ? hp.average : undefined;
	// La media se calcula de la fórmula: solo se guarda si no coincide (p. ej. el Duergar de 2014).
	const keepAverage = average !== undefined && (!formula || averageHp(formula) !== average);
	return { ...(keepAverage ? { hp: average } : {}), ...(formula ? { hp_formula: formula } : {}) };
}

function speedFields(speed: unknown): { speed: Obj; hover: boolean } {
	const out: Obj = {};
	let hover = false;
	if (typeof speed === "number") return { speed: { walk: speed }, hover };
	if (!isObj(speed)) return { speed: out, hover };
	if (speed.canHover) hover = true;
	for (const key of ["walk", "burrow", "climb", "fly", "swim"]) {
		const v = speed[key];
		if (v === undefined) continue;
		if (typeof v === "number") out[key] = v;
		else if (isObj(v)) {
			let cond = plainText(str(v.condition));
			if (/\bhover\b/i.test(cond)) {
				hover = true;
				cond = cond.replace(/\(hover\)/i, "").replace(/\bhover;\s*/i, "").replace(/\(\s*\)/, "").trim();
			}
			out[key] = cond ? `${str(v.number)} ft. ${cond}` : Number(v.number);
		}
	}
	// Velocidades alternativas (licántropos) y a elegir (enjambre de insectos): como texto.
	if (isObj(speed.alternate))
		for (const [key, list] of Object.entries(speed.alternate)) {
			const extra = arr(list)
				.map((x) => (isObj(x) ? `${str(x.number)} ft. ${plainText(str(x.condition))}`.trim() : `${str(x)} ft.`))
				.join(", ");
			const base = out[key];
			out[key] = base === undefined ? extra : `${typeof base === "number" ? `${base} ft.` : str(base)}, or ${extra}`;
		}
	if (isObj(speed.choose)) {
		const ch = speed.choose;
		for (const key of arr(ch.from).map(str)) if (out[key] === undefined) out[key] = `${str(ch.amount)} ft. ${plainText(str(ch.note))}`.trim();
	}
	return { speed: out, hover };
}

function crFields(cr: unknown, pbNote: unknown): Obj {
	const out: Obj = {};
	if (typeof cr === "string") out.cr = cr;
	else if (isObj(cr)) {
		out.cr = str(cr.cr);
		if (cr.xpLair !== undefined) out.lair = true; // 2024: siempre los PX del VD siguiente (regla)
		if (cr.lair !== undefined) {
			// 2014: VD en la guarida (no son PX): sus PX, a mano.
			const xp = xpForCr(str(cr.lair));
			out.lair = true;
			if (xp !== undefined) out.xp_lair = xp;
		}
		if (typeof cr.xp === "number" && cr.xp !== xpForCr(str(cr.cr))) out.xp = cr.xp;
	}
	if (!out.cr && pbNote) out.pb = plainText(str(pbNote));
	return out;
}

// ================================================================ características y competencias

const signedNumber = (v: unknown): number | undefined => {
	const m = /^\s*([+-−]?\d+)\s*$/.exec(str(v).replace("\u2212", "-"));
	return m ? Number(m[1]) : undefined;
};

function savesAndSkills(m: Obj, pb: number | undefined): Obj {
	const out: Obj = {};
	const mod = (a: string) => (typeof m[a] === "number" ? abilityMod(m[a]) : undefined);
	if (isObj(m.save)) {
		const profs: string[] = [];
		const saves: Obj = {};
		for (const [a, v] of Object.entries(m.save)) {
			const ab = a.toLowerCase();
			if (!(ABILITIES as readonly string[]).includes(ab)) continue;
			const n = signedNumber(v);
			const md = mod(ab);
			if (n !== undefined && md !== undefined && pb !== undefined && n === md + pb) profs.push(ab);
			else saves[ab] = n ?? plainText(str(v));
		}
		if (profs.length) out.save_proficiencies = ABILITIES.filter((a) => profs.includes(a));
		if (Object.keys(saves).length) out.saves = saves;
	}
	if (isObj(m.skill)) {
		const profs: Obj = {};
		const values: Obj = {};
		for (const [k, v] of Object.entries(m.skill)) {
			const id = k.toLowerCase().replace(/\s+/g, "_");
			const ability = SKILLS[id];
			if (!ability) continue;
			const n = signedNumber(v);
			const md = mod(ability);
			if (n !== undefined && md !== undefined && pb !== undefined && n === md + pb) profs[id] = "proficient";
			else if (n !== undefined && md !== undefined && pb !== undefined && n === md + 2 * pb) profs[id] = "expertise";
			else values[id] = n ?? plainText(str(v));
		}
		if (Object.keys(profs).length) out.skill_proficiencies = profs;
		if (Object.keys(values).length) out.skills = values;
	}
	return out;
}

const DAMAGE = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);

type ListFormatCtor = new (lang: string, o: { type: "conjunction" }) => { format(items: string[]): string };
const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
const andList = (items: string[]) => (ListFormat ? new ListFormat("en", { type: "conjunction" }).format(items) : items.join(", "));

/** Resistencias, inmunidades, vulnerabilidades o inmunidades a condiciones: ids, o texto si llevan nota. */
function defenseList(v: unknown, key: string, ids: (s: string) => boolean): string[] {
	const out: string[] = [];
	for (const x of arr(v)) {
		if (typeof x === "string") out.push(ids(x.toLowerCase()) ? x.toLowerCase() : plainText(x));
		else if (isObj(x)) {
			if (x.special !== undefined) out.push(plainText(str(x.special)));
			else {
				const items = arr(x[key]).map((y) => (typeof y === "string" ? y : isObj(y) ? defenseList(y, key, ids).join("; ") : ""));
				const text = [x.preNote ? plainText(str(x.preNote)) : "", andList(items.filter(Boolean)), x.note ? plainText(str(x.note)) : ""].filter(Boolean).join(" ");
				if (text) out.push(text);
			}
		}
	}
	return out;
}

const SENSE_RE = /^(darkvision|blindsight|tremorsense|truesight)\s+(\d+)\s*ft\.?\s*(.*)$/i;

function sensesFields(v: unknown): Obj {
	const senses: Obj = {};
	const other: string[] = [];
	for (const s of arr(v).map((x) => plainText(str(x)))) {
		const m = SENSE_RE.exec(s);
		if (m) senses[m[1].toLowerCase()] = m[3].trim() ? `${m[2]} ft. ${m[3].trim()}` : Number(m[2]);
		else if (s) other.push(s);
	}
	return { ...(Object.keys(senses).length ? { senses } : {}), ...(other.length ? { senses_other: other } : {}) };
}

/** Idiomas: 5etools parte algunas frases por las comas («and Sylvan but can't speak them»); se vuelven a unir. */
function languages(v: unknown): string[] {
	const out: string[] = [];
	for (const raw of arr(v).map((x) => plainText(str(x)))) {
		if (!raw) continue;
		if (out.length && /^(and|but|or)\b/i.test(raw)) out[out.length - 1] += `, ${raw}`;
		else out.push(...raw.split(/;\s*/).filter(Boolean));
	}
	return out;
}

/**
 * Mayúscula inicial en cada palabra. Una letra con tilde o un apóstrofo no empiezan palabra (con `\b`,
 * «bastón» salía «BastóN» y «smith's», «Smith'S»).
 */
const titleCase = (s: string) => s.replace(/(^|[^\p{L}\p{M}'’])(\p{Ll})/gu, (_all, pre: string, c: string) => pre + c.toUpperCase());

function gearList(v: unknown): string[] {
	return arr(v)
		.map((x) => {
			if (typeof x === "string") return titleCase(plainText(x.split("|")[0]));
			if (isObj(x)) {
				const name = titleCase(plainText(str(x.item).split("|")[0]));
				return typeof x.quantity === "number" && x.quantity > 1 ? `${name} (${x.quantity})` : name;
			}
			return "";
		})
		.filter(Boolean);
}

// ================================================================ rasgos y acciones

interface Entry {
	name: string;
	text: string;
	uses?: number;
	uses_lair?: number;
	uses_per?: "short" | "long";
	recharge?: number | "short" | "long" | "short_or_long";
}

/** Separa del nombre los usos y la recarga («Bite {@recharge 5}», «Legendary Resistance (3/Day, or 4/Day in Lair)»…). */
export function parseEntryName(raw: string): Omit<Entry, "text"> {
	let name = raw.trim();
	const out: Omit<Entry, "text" | "name"> = {};
	const tag = /\s*\{@recharge(?:\s+(\d))?\}\s*$/.exec(name);
	if (tag) {
		out.recharge = tag[1] ? Number(tag[1]) : 6;
		name = name.slice(0, tag.index).trim();
	}
	const paren = /\s*\(([^()]*)\)\s*$/.exec(name);
	if (paren) {
		const keep: string[] = [];
		for (const part of paren[1].split(/;\s*/)) {
			let m: RegExpExecArray | null;
			if ((m = /^(\d+)\/Day(?:,? or (\d+)\/Day in Lair)?$/i.exec(part))) {
				out.uses = Number(m[1]);
				if (m[2]) out.uses_lair = Number(m[2]);
			} else if ((m = /^(\d+)\/(Short|Long) Rest$/i.exec(part))) {
				out.uses = Number(m[1]);
				out.uses_per = m[2].toLowerCase() as "short" | "long";
			} else if ((m = /^Recharge (\d)(?:[–-]6)?$/i.exec(part))) out.recharge = Number(m[1]);
			else if (/^Recharges? after a Short or Long Rest$/i.test(part)) out.recharge = "short_or_long";
			else if (/^Recharges? after a Long Rest$/i.test(part)) out.recharge = "long";
			else if (/^Recharges? after a Short Rest$/i.test(part)) out.recharge = "short";
			else keep.push(part);
		}
		name = name.slice(0, paren.index).trim() + (keep.length ? ` (${keep.join("; ")})` : "");
	}
	return { name: plainText(name), ...out };
}

function entryList(v: unknown): Entry[] {
	return arr(v)
		.filter(isObj)
		.map((e) => ({ ...parseEntryName(str(e.name)), text: entriesToMarkdown(e.entries ?? e.entry) }));
}

// ================================================================ conjuros

interface PerDay {
	uses: number;
	each?: boolean;
	spells: string[];
}
interface Block {
	name: string;
	uses?: number;
	uses_per?: "short" | "long";
	recharge?: number | "short" | "long" | "short_or_long";
	hide_dc?: boolean;
	ability?: string;
	text?: string;
	at_will?: string[];
	per_day?: PerDay[];
	levels?: { level: number; slots?: number; spells: string[] }[];
	footer?: string;
}

/** Nombre de conjuro de una lista: la marca, sin la fuente («{@spell Fireball|XPHB}» → «{@spell Fireball}»). */
const spellItem = (s: unknown) => convertText(str(s)).replace(/\\\*/g, "*");

function perDayFrom(daily: unknown): PerDay[] {
	if (!isObj(daily)) return [];
	return Object.entries(daily)
		.map(([k, list]) => ({ uses: Number.parseInt(k, 10) || 1, each: k.endsWith("e"), spells: arr(list).map(spellItem) }))
		.sort((a, b) => b.uses - a.uses);
}

function spellCount(b: Obj): number {
	let n = arr(b.will).length;
	for (const key of ["daily", "recharge", "legendary", "restLong", "rest", "weekly"]) if (isObj(b[key])) for (const l of Object.values(b[key])) n += arr(l).length;
	if (isObj(b.spells)) for (const l of Object.values(b.spells)) n += isObj(l) ? arr(l.spells).length : 0;
	return n;
}

/** Bloque completo (principal o de varios conjuros): texto, listas y texto final. */
function fullBlock(b: Obj, is2024: boolean): Block {
	// Los usos del nombre («Protective Magic (3/Day)») ya los dan sus listas: fuera del nombre. Una recarga
	// (no hay campo de recarga en los bloques) se queda escrita en él.
	const parsed = parseEntryName(str(b.name));
	const recharge = typeof parsed.recharge === "number" ? ` (Recharge ${parsed.recharge === 6 ? "6" : `${parsed.recharge}–6`})` : "";
	const block: Block = { name: `${parsed.name || "Spellcasting"}${recharge}` };
	if (b.ability) block.ability = str(b.ability).toLowerCase();
	// En 2014, `hidden` dice que una lista ya está escrita en el texto (los mefitas): no se repite. En 2024
	// (bloques extra) las listas se conservan, por sus casillas.
	const hidden = new Set(is2024 ? [] : arr(b.hidden).map(str));
	const text = entriesToMarkdown(b.headerEntries);
	if (text) block.text = text;
	if (!hidden.has("will") && arr(b.will).length) block.at_will = arr(b.will).map(spellItem);
	const perDay = perDayFrom(b.daily);
	if (perDay.length) block.per_day = perDay;
	if (isObj(b.spells))
		block.levels = Object.entries(b.spells)
			.map(([lvl, l]) => ({ level: Number(lvl), ...(isObj(l) && typeof l.slots === "number" ? { slots: l.slots } : {}), spells: isObj(l) ? arr(l.spells).map(spellItem) : [] }))
			.sort((a, c) => a.level - c.level);
	// Listas que no son al día (recarga, legendaria, por descanso): al texto final, en Markdown.
	const extra: string[] = [];
	for (const [key, label] of [
		["recharge", "Recharge"],
		["legendary", "Legendary"],
		["restLong", "Long Rest"],
		["rest", "Rest"],
		["weekly", "Week"],
	] as const)
		if (isObj(b[key]))
			for (const [k, list] of Object.entries(b[key]))
				extra.push(key === "recharge" ? `**(Recharge ${k}–6):** ${spellNames(list)}` : `**${Number.parseInt(k, 10) || 1}/${label}:** ${spellNames(list)}`);
	const footer = [entriesToMarkdown(b.footerEntries), ...extra].filter(Boolean).join("\n\n");
	if (footer) block.footer = footer;
	return block;
}

/** Bloque extra de 2024 con varios conjuros y usos compartidos: nombre, texto, usos o recarga, sin listas. */
function pooledBlock(b: Obj, main: Block | null): Block {
	const parsed = parseEntryName(str(b.name));
	const block: Block = { name: parsed.name || "Spellcasting" };
	const daily = isObj(b.daily) ? Object.keys(b.daily) : [];
	if (parsed.uses !== undefined) block.uses = parsed.uses;
	else if (daily.length) block.uses = Number.parseInt(daily[0], 10) || 1;
	if (isObj(b.restLong)) {
		block.uses = Number.parseInt(Object.keys(b.restLong)[0], 10) || 1;
		block.uses_per = "long";
	}
	if (parsed.recharge !== undefined) block.recharge = parsed.recharge;
	else if (isObj(b.recharge)) block.recharge = Number(Object.keys(b.recharge)[0]) || 6;
	if (b.ability) block.ability = str(b.ability).toLowerCase();
	if (main?.ability && block.ability === main.ability) block.hide_dc = true;
	const text = entriesToMarkdown(b.headerEntries);
	if (text) block.text = text;
	return block;
}

const DISPLAY_SECTION: Record<string, string> = { action: "actions", bonus: "bonus_actions", reaction: "reactions", legendary: "legendary_actions" };

/**
 * Bloques de conjuros (decisiones del 2026-11-24): el principal (el primero visible con más de un conjuro,
 * o el primero visible); los de un solo conjuro con usos al día o a voluntad, juntados con él; los de uso
 * legendario, con recarga, por descanso o de criaturas sin principal, a una entrada de su sección; los de
 * varios conjuros, bloque propio.
 */
function spellcasting(m: Obj, sections: Record<string, Entry[]>, is2024: boolean): Block[] {
	const raw = arr(m.spellcasting).filter(isObj);
	if (!raw.length) return [];
	// En 2024, un bloque con `hidden` es uno extra (el libro lo muestra como una entrada de otra sección). En
	// 2014, `hidden` solo dice que una lista ya está escrita en el texto (los mefitas): todos son bloques.
	const extra = (b: Obj) => is2024 && arr(b.hidden).length > 0;
	const main = raw.find((b) => !extra(b) && spellCount(b) > 1) ?? raw.find((b) => !extra(b)) ?? null;
	const blocks: Block[] = [];
	const mainBlock = main ? fullBlock(main, is2024) : null;
	if (mainBlock) blocks.push(mainBlock);
	for (const b of raw) {
		if (b === main) continue;
		const single = spellCount(b) === 1;
		const daily = isObj(b.daily) ? Object.entries(b.daily) : [];
		const onlyDailyOrWill = !b.recharge && !b.legendary && !b.restLong && !b.rest && !b.weekly && (daily.length > 0 || arr(b.will).length > 0);
		if (single && mainBlock && onlyDailyOrWill) {
			// A la lista del bloque principal con sus mismos usos al día (o a voluntad), o a una línea nueva.
			if (arr(b.will).length) {
				mainBlock.at_will = [...(mainBlock.at_will ?? []), ...arr(b.will).map(spellItem)];
				continue;
			}
			const [key, list] = daily[0];
			const uses = Number.parseInt(key, 10) || 1;
			const spells = arr(list).map(spellItem);
			const target = mainBlock.per_day?.find((p) => p.uses === uses && (p.each || p.spells.length === 1));
			if (target) {
				target.each = true;
				target.spells.push(...spells);
			} else mainBlock.per_day = [...(mainBlock.per_day ?? []), { uses, each: true, spells }].sort((a, c) => c.uses - a.uses);
			continue;
		}
		if (single || !mainBlock) {
			// Una entrada normal en la sección de su displayAs, con su texto, usos y recarga.
			const section = DISPLAY_SECTION[str(b.displayAs)] ?? "actions";
			const entry: Entry = { ...parseEntryName(str(b.name)), text: entriesToMarkdown(b.headerEntries) };
			if (daily.length && entry.uses === undefined) entry.uses = Number.parseInt(daily[0][0], 10) || 1;
			if (isObj(b.recharge) && entry.recharge === undefined) entry.recharge = Number(Object.keys(b.recharge)[0]) || 6;
			if (isObj(b.restLong) && entry.uses === undefined) {
				entry.uses = Number.parseInt(Object.keys(b.restLong)[0], 10) || 1;
				entry.uses_per = "long";
			}
			if (!single) {
				// Sin bloque principal pero con varios conjuros: las listas, al texto de la entrada.
				const lists: string[] = [];
				if (arr(b.will).length) lists.push(`**At Will:** ${spellNames(b.will)}`);
				for (const [k, l] of daily) lists.push(`**${Number.parseInt(k, 10) || 1}/Day${k.endsWith("e") ? " Each" : ""}:** ${spellNames(l)}`);
				if (lists.length) entry.text = [entry.text, ...lists].filter(Boolean).join("\n\n");
			}
			(sections[section] ??= []).push(entry);
			continue;
		}
		// Varios conjuros con usos compartidos («casts one of the following»): bloque propio, con sus usos o su
		// recarga en el bloque (casillas tras el nombre) y sin repetir los conjuros, que ya nombra su texto (en los
		// 25 de los bestiarios de 2024, comprobado). Sin CD ni ataque si es la misma característica que la del
		// bloque principal (pedido del desarrollador, 2026-11-24).
		blocks.push(is2024 ? pooledBlock(b, mainBlock) : fullBlock(b, is2024));
	}
	return blocks;
}

// ================================================================ grupos legendarios

export interface LegendaryGroup {
	name: string;
	source: string;
	lairActions?: unknown[];
	regionalEffects?: unknown[];
}

/** Índice de grupos legendarios por «nombre|libro», con las copias (`_copy` + `appendArr`) resueltas. */
export function legendaryGroupIndex(groups: unknown[]): Map<string, LegendaryGroup> {
	const raw = new Map<string, Obj>();
	for (const g of groups.filter(isObj)) raw.set(`${str(g.name)}|${str(g.source)}`.toLowerCase(), g);
	const resolve = (g: Obj, depth = 0): LegendaryGroup => {
		let base: Obj = {};
		if (isObj(g._copy) && depth < 5) {
			const parent = raw.get(`${str(g._copy.name)}|${str(g._copy.source)}`.toLowerCase());
			if (parent) base = { ...resolve(parent, depth + 1) };
			if (isObj(g._copy._mod))
				for (const [key, mods] of Object.entries(g._copy._mod))
					for (const mod of arr(mods).filter(isObj))
						if (str(mod.mode) === "appendArr") base[key] = [...arr(base[key]), ...arr(mod.items)];
		}
		return {
			name: str(g.name),
			source: str(g.source),
			lairActions: arr(g.lairActions ?? base.lairActions),
			regionalEffects: arr(g.regionalEffects ?? base.regionalEffects),
		};
	};
	const out = new Map<string, LegendaryGroup>();
	for (const [k, g] of raw) out.set(k, resolve(g));
	return out;
}

/**
 * Acciones de guarida: el texto antes de la lista es la introducción; cada punto, una entrada (sin nombre
 * en 2014). Un texto después de la lista, una entrada sin nombre más.
 */
function lairActions(list: unknown[]): { header: string; entries: Entry[] } {
	const header: string[] = [];
	const entries: Entry[] = [];
	for (const e of list) {
		if (typeof e === "string") {
			if (entries.length) entries.push({ name: "", text: convertText(e) });
			else header.push(convertText(e));
		} else if (isObj(e) && str(e.type) === "list")
			for (const it of arr(e.items)) {
				if (typeof it === "string") entries.push({ name: "", text: convertText(it) });
				else if (isObj(it)) entries.push({ name: plainText(str(it.name)), text: it.entry !== undefined ? convertText(str(it.entry)) : entriesToMarkdown(it.entries) });
			}
		else if (isObj(e)) entries.push({ name: plainText(str(e.name)), text: entriesToMarkdown(e.entries) });
	}
	return { header: header.join("\n\n"), entries };
}

// ================================================================ criatura completa

export interface ImportedCreature {
	name: string;
	source: string;
	/** Propiedades de la nota (las de statblock). */
	data: Obj;
	/** Texto del cuerpo, debajo del bloque del statblock (variantes de 2014, efectos regionales). */
	body: string;
}

export interface ImportContext {
	groups: Map<string, LegendaryGroup>;
	/** Encabezados del cuerpo, en el idioma del contenido. */
	headings: { regionalEffects: string };
}

/** ¿Es una criatura importable? (tiene nombre). */
export function isMonster(v: unknown): v is Obj {
	return isObj(v) && typeof v.name === "string" && v.name.trim() !== "";
}

/** Convierte una criatura de 5etools. */
export function convertMonster(m: Obj, ctx: ImportContext): ImportedCreature {
	const source = str(m.source);
	const is2024 = SOURCES_2024.has(source) || !!m.srd52 || !!m.basicRules2024;
	const data: Obj = { statblock: is2024 ? "dnd5e-2024" : "dnd5e-2014", name: str(m.name).trim() };
	if (m.isNamedCreature) data.named = true;
	if (typeof m.shortName === "string") data.short_name = m.shortName;

	data.size = arr(m.size).map((s) => SIZE[str(s)]).filter(Boolean);
	const t = typeFields(m.type);
	data.type = t.type;
	if (t.subtype.length) data.subtype = t.subtype;
	if (t.swarm) data.swarm_creature_size = [t.swarm];
	const alignment = alignmentPhrase(m.alignment);
	if (alignment) data.alignment = alignment;

	Object.assign(data, acFields(m.ac), hpFields(m.hp));
	if (isObj(m.initiative)) {
		const p = Number(m.initiative.proficiency);
		if (p === 1) data.initiative_proficiency = "proficient";
		else if (p === 2) data.initiative_proficiency = "expertise";
	}
	const sp = speedFields(m.speed);
	if (Object.keys(sp.speed).length) data.speed = sp.speed;
	if (sp.hover) data.hover = true;
	Object.assign(data, crFields(m.cr, m.pbNote));

	for (const a of ABILITIES) if (typeof m[a] === "number") data[a] = m[a];
	const pb = typeof data.cr === "string" ? pbForCr(data.cr) : undefined;
	Object.assign(data, savesAndSkills(m, pb));

	const isDamage = (s: string) => DAMAGE.has(s);
	const vul = defenseList(m.vulnerable, "vulnerable", isDamage);
	const res = defenseList(m.resist, "resist", isDamage);
	const imm = defenseList(m.immune, "immune", isDamage);
	const cond = defenseList(m.conditionImmune, "conditionImmune", () => true);
	if (vul.length) data.vulnerabilities = vul;
	if (res.length) data.resistances = res;
	if (imm.length) data.immunities = imm;
	if (cond.length) data.condition_immunities = cond;
	const gear = gearList(m.gear);
	if (gear.length) data.gear = gear;
	Object.assign(data, sensesFields(m.senses));
	// Percepción pasiva: solo si no coincide con 10 + Percepción (o 10 + Sabiduría).
	if (typeof m.passive === "number" && typeof m.wis === "number") {
		const prof = (data.skill_proficiencies as Obj | undefined)?.perception;
		const manual = (data.skills as Obj | undefined)?.perception;
		const perception = typeof manual === "number" ? manual : abilityMod(m.wis) + (prof === "expertise" ? 2 : prof === "proficient" ? 1 : 0) * (pb ?? 0);
		if (m.passive !== 10 + perception) data.passive_perception = m.passive;
	} else if (m.passive !== undefined) data.passive_perception = typeof m.passive === "number" ? m.passive : plainText(str(m.passive));
	const langs = languages(m.languages);
	if (langs.length) data.languages = langs;

	const sections: Record<string, Entry[]> = {
		traits: entryList(m.trait),
		actions: entryList(m.action),
		bonus_actions: entryList(m.bonus),
		reactions: entryList(m.reaction),
		legendary_actions: entryList(m.legendary),
	};
	const blocks = spellcasting(m, sections, is2024);
	if (blocks.length) data.spellcasting = blocks;
	for (const [k, list] of Object.entries(sections)) if (list.length) data[k] = list;
	if (typeof m.legendaryActions === "number" && m.legendaryActions !== 3) data.legendary_uses = m.legendaryActions;
	if (typeof m.legendaryActionsLair === "number") data.legendary_uses_lair = m.legendaryActionsLair;
	if (Array.isArray(m.legendaryHeader)) data.legendary_header = entriesToMarkdown(m.legendaryHeader);

	// Grupo legendario: acciones de guarida a su sección; efectos regionales, al cuerpo.
	const body: string[] = [];
	if (isObj(m.variant) || Array.isArray(m.variant)) for (const v of arr(m.variant).filter(isObj)) body.push(`## ${plainText(str(v.name))}\n\n${entriesToMarkdown(v.entries)}`.trim());
	if (isObj(m.legendaryGroup)) {
		const g = ctx.groups.get(`${str(m.legendaryGroup.name)}|${str(m.legendaryGroup.source)}`.toLowerCase());
		if (g?.lairActions?.length) {
			const lair = lairActions(g.lairActions);
			if (lair.header) data.lair_actions_header = lair.header;
			if (lair.entries.length) data.lair_actions = lair.entries;
		}
		if (g?.regionalEffects?.length) body.push(`## ${ctx.headings.regionalEffects}\n\n${entriesToMarkdown(g.regionalEffects)}`);
	}

	const env = arr(m.environment).map((e) => str(e).toLowerCase()).filter(Boolean);
	if (env.length) data.habitat = env;
	const treasure = arr(m.treasure).map((e) => str(e).toLowerCase()).filter(Boolean);
	if (treasure.length) data.treasure = treasure;
	if (source) data.source = source;
	if (typeof m.page === "number") data.page = m.page;

	return { name: str(m.name).trim(), source, data, body: body.join("\n\n") };
}

/** ¿Tiene la criatura un grupo legendario que no está en los archivos cargados? */
export function missingGroup(m: Obj, groups: Map<string, LegendaryGroup>): boolean {
	return isObj(m.legendaryGroup) && !groups.has(`${str(m.legendaryGroup.name)}|${str(m.legendaryGroup.source)}`.toLowerCase());
}

/** VD de la criatura (para mostrarlo en la lista del diálogo). */
export function crLabel(m: Obj): string {
	return typeof m.cr === "string" ? m.cr : isObj(m.cr) ? str(m.cr.cr) : "";
}
