import { AbstractInputSuggest, App, setIcon } from "obsidian";
import { currentLanguage, T, TranslationKey } from "../i18n";
import { allConditions } from "../initiative/conditions";
import type StrakesTTRPG from "../main";
import { averageHp, Derived, derive, signed, signedValue } from "./compute";
import {
	ABILITIES,
	Ability,
	CREATURE_TYPES,
	DAMAGE_TYPES,
	EntrySection,
	readStatblock,
	SENSES,
	SIZES,
	SKILLS,
	SPEEDS,
	Statblock,
} from "./data";
import { ALIGNMENTS, alignmentFromInput, alignmentName, creatureRef, legendaryIntro } from "./markdown";
import { Draft } from "./notes";

/**
 * Formulario de un statblock (1.4, §10.2). Cada campo está ligado a una propiedad del borrador (`Draft`,
 * las propiedades de la nota tal cual) y lo modifica al escribir; `changed()` avisa a la vista, que
 * redibuja la vista previa, guarda y actualiza los valores calculados.
 *
 * Valores calculados: el campo vacío muestra en gris (placeholder) lo que se calcula; si se escribe
 * algo, manda lo escrito. Los placeholders se recalculan con `refresh()` tras cada cambio.
 */

type Obj = Record<string, unknown>;
type Refresher = (sb: Statblock, d: Derived) => void;

export interface FormContext {
	plugin: StrakesTTRPG;
	draft: Draft;
	/** Nombre de la nota sin prefijo ni sufijo: el nombre si `name` está vacío. */
	fallbackName: string;
	/** Tras cualquier cambio de un valor. */
	changed(): void;
	/** Tras un cambio de estructura (añadir, quitar o mover una entrada): vuelve a dibujar el formulario. */
	rerender(): void;
}

const tk = (key: string, vars?: Record<string, string | number>) => T(key as TranslationKey, vars);

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** El objeto `obj[key]`, creándolo si no lo es (p. ej. `speed`). */
function objAt(obj: Obj, key: string): Obj {
	if (!isObj(obj[key])) obj[key] = {};
	return obj[key] as Obj;
}

/** La lista `obj[key]` (creándola si no lo es), solo con objetos. */
function listAt(obj: Obj, key: string): Obj[] {
	const list = Array.isArray(obj[key]) ? (obj[key] as unknown[]).filter(isObj) : [];
	obj[key] = list;
	return list;
}

/** Lista de textos `obj[key]`; un texto suelto cuenta como lista de uno. */
function stringsAt(obj: Obj, key: string): string[] {
	const v = obj[key];
	const list = Array.isArray(v) ? v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : "")).filter(Boolean) : typeof v === "string" && v ? [v] : [];
	obj[key] = list;
	return list;
}

const display = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Un número entero, o `undefined` si el texto no lo es. */
function parseIntOrUndefined(text: string): number | undefined {
	const t = text.trim();
	return /^[+-]?\d+$/.test(t) ? Number(t) : undefined;
}

/** Número si el texto lo es («+9» → 9, «12» → 12); si no, el texto. */
function numOrText(text: string): number | string {
	const t = text.trim().replace(/^−/, "-");
	return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : text.trim();
}

/** Sugerencias para un campo de texto: una lista de opciones con su etiqueta. */
class OptionSuggest extends AbstractInputSuggest<{ value: string; label: string }> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private options: () => { value: string; label: string }[],
		private onPick: (value: string, label: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): { value: string; label: string }[] {
		const q = query.trim().toLowerCase();
		return this.options().filter((o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
	}

	renderSuggestion(o: { value: string; label: string }, el: HTMLElement): void {
		el.setText(o.label);
	}

	selectSuggestion(o: { value: string; label: string }): void {
		this.input.value = o.label;
		this.onPick(o.value, o.label);
		this.close();
	}
}

const CR_OPTIONS = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const HABITATS = ["any", "arctic", "coastal", "desert", "forest", "grassland", "hill", "mountain", "planar", "swamp", "underdark", "underwater", "urban"];
const TREASURES = ["any", "arcana", "armaments", "implements", "individual", "relics"];

/** Dibuja el formulario en `container`. */
export function buildForm(container: HTMLElement, ctx: FormContext): void {
	const { draft, plugin } = ctx;
	const app = plugin.app;
	const refreshers: Refresher[] = [];
	const refresh = () => {
		const sb = readStatblock(draft, ctx.fallbackName);
		const d = derive(sb, true);
		for (const r of refreshers) r(sb, d);
	};
	const changed = () => {
		ctx.changed();
		refresh();
	};
	container.empty();
	container.addClass("strakes-sb-form");

	// ------------------------------------------------------------ piezas

	const section = (key: string): HTMLElement => {
		const det = container.createEl("details", { cls: "strakes-sb-section" });
		det.open = true;
		det.createEl("summary", { text: tk(key) });
		return det.createDiv("strakes-sb-section-body");
	};
	const row = (parent: HTMLElement, label?: string, cls = ""): HTMLElement => {
		const r = parent.createDiv(`strakes-sb-field ${cls}`.trim());
		if (label) r.createSpan({ cls: "strakes-sb-label", text: label });
		return r;
	};

	/**
	 * Campo de texto ligado a `obj[key]`. `kind`: `text` (texto), `int` (entero; otra cosa no se guarda y
	 * el campo se marca), `numOrText` (número si lo es, si no el texto). `computed` da el placeholder.
	 */
	const input = (
		parent: HTMLElement,
		obj: Obj,
		key: string,
		opts: { kind?: "text" | "int" | "numOrText"; placeholder?: string; computed?: (sb: Statblock, d: Derived) => string; cls?: string } = {},
	): HTMLInputElement => {
		const el = parent.createEl("input", { type: "text", cls: `strakes-sb-input ${opts.cls ?? ""}`.trim() });
		el.value = display(obj[key]);
		if (opts.placeholder) el.placeholder = opts.placeholder;
		el.addEventListener("input", () => {
			const text = el.value;
			const kind = opts.kind ?? "text";
			el.removeClass("is-invalid");
			if (!text.trim()) delete obj[key];
			else if (kind === "int") {
				const n = parseIntOrUndefined(text);
				if (n === undefined) {
					el.addClass("is-invalid");
					delete obj[key];
				} else obj[key] = n;
			} else if (kind === "numOrText") obj[key] = numOrText(text);
			else obj[key] = text;
			changed();
		});
		const computed = opts.computed;
		if (computed) refreshers.push((sb, d) => (el.placeholder = computed(sb, d)));
		return el;
	};
	const textarea = (parent: HTMLElement, obj: Obj, key: string, placeholder?: (sb: Statblock, d: Derived) => string): HTMLTextAreaElement => {
		const el = parent.createEl("textarea", { cls: "strakes-sb-textarea" });
		el.value = display(obj[key]);
		el.rows = 3;
		el.addEventListener("input", () => {
			if (el.value.trim()) obj[key] = el.value;
			else delete obj[key];
			changed();
		});
		if (placeholder) refreshers.push((sb, d) => (el.placeholder = placeholder(sb, d)));
		return el;
	};
	const check = (parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, after?: () => void): HTMLInputElement => {
		const lab = parent.createEl("label", { cls: "strakes-sb-check" });
		const cb = lab.createEl("input", { type: "checkbox" });
		cb.checked = get();
		lab.appendText(label);
		cb.addEventListener("change", () => {
			set(cb.checked);
			changed();
			after?.();
		});
		return cb;
	};
	const boolCheck = (parent: HTMLElement, label: string, obj: Obj, key: string, after?: () => void) =>
		check(parent, label, () => obj[key] === true, (v) => (v ? (obj[key] = true) : delete obj[key]), after);
	const select = (parent: HTMLElement, options: [string, string][], get: () => string, set: (v: string) => void): HTMLSelectElement => {
		const el = parent.createEl("select", { cls: "dropdown strakes-sb-select" });
		for (const [value, label] of options) el.createEl("option", { value, text: label });
		el.value = get();
		el.addEventListener("change", () => {
			set(el.value);
			changed();
		});
		return el;
	};

	/** Botones que alternan valores de una lista (tamaños, tipos, daños, condiciones). */
	const toggles = (parent: HTMLElement, list: () => string[], save: (l: string[]) => void, options: [string, string][]) => {
		const wrap = parent.createDiv("strakes-sb-toggles");
		for (const [value, label] of options) {
			const b = wrap.createEl("button", { cls: "strakes-sb-toggle", text: label });
			const on = () => list().some((x) => x.toLowerCase() === value.toLowerCase());
			b.toggleClass("is-active", on());
			b.addEventListener("click", (e) => {
				e.preventDefault();
				const l = list();
				save(on() ? l.filter((x) => x.toLowerCase() !== value.toLowerCase()) : [...l, value]);
				b.toggleClass("is-active", on());
				changed();
			});
		}
		return wrap;
	};

	/**
	 * Etiquetas de texto libre (subtipos, idiomas, equipo…): cada una con su ×; se añaden con Intro o al
	 * salir del campo. `only` filtra cuáles se muestran (las demás de la lista se conservan); `label`
	 * traduce las conocidas; `suggest` ofrece opciones.
	 */
	const tags = (
		parent: HTMLElement,
		obj: Obj,
		key: string,
		opts: { only?: (x: string) => boolean; label?: (x: string) => string; suggest?: () => { value: string; label: string }[]; placeholder?: string } = {},
	) => {
		const wrap = parent.createDiv("strakes-sb-tags");
		const chips = wrap.createDiv("strakes-sb-tag-list");
		const field = wrap.createEl("input", { type: "text", cls: "strakes-sb-input strakes-sb-tag-input", placeholder: opts.placeholder ?? T("sbForm.addTag") });
		const draw = () => {
			chips.empty();
			for (const x of stringsAt(obj, key)) {
				if (opts.only && !opts.only(x)) continue;
				const chip = chips.createSpan({ cls: "strakes-sb-tag", text: opts.label ? opts.label(x) : x });
				const rm = chip.createSpan({ cls: "strakes-sb-tag-remove", attr: { "aria-label": T("sbForm.remove") } });
				setIcon(rm, "x");
				rm.addEventListener("click", () => {
					obj[key] = stringsAt(obj, key).filter((y) => y !== x);
					draw();
					changed();
				});
			}
		};
		const add = (value: string) => {
			let v = value.trim();
			if (!v) return;
			// Escrito con su nombre traducido («Infraoscuridad»): se guarda su valor («underdark»).
			const match = opts.suggest?.().find((o) => o.label.toLowerCase() === v.toLowerCase());
			if (match) v = match.value;
			const list = stringsAt(obj, key);
			if (!list.includes(v)) obj[key] = [...list, v];
			field.value = "";
			draw();
			changed();
		};
		field.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			add(field.value);
		});
		// Al salir del campo se añade lo escrito, con un retraso: si se eligió una sugerencia con el ratón,
		// ya se añadió ella y el campo está vacío.
		field.addEventListener("blur", () => window.setTimeout(() => add(field.value), 200));
		const suggest = opts.suggest;
		if (suggest) new OptionSuggest(app, field, suggest, (value) => add(value));
		draw();
		return wrap;
	};

	// ------------------------------------------------------------ 1. Cabecera

	{
		const body = section("sbForm.section.header");
		input(row(body, T("sbForm.name")), draft, "name", { placeholder: ctx.fallbackName, cls: "is-wide" });
		const sn = row(body, T("sbForm.shortName"));
		input(sn, draft, "short_name", { computed: (sb) => creatureRef({ ...sb, short_name: "" }), cls: "is-wide" });
		const named = row(body);
		boolCheck(named, T("sbForm.named"), draft, "named");
		named.createSpan({ cls: "strakes-sb-hint", text: T("sbForm.namedHint") });

		const size = row(body, T("sbForm.size"));
		const sizeLabels = (s: string) => tk(`statblock.size.${s}`);
		toggles(size, () => stringsAt(draft, "size"), (l) => (draft.size = l), SIZES.map((s) => [s, sizeLabels(s)]));
		const type = row(body, T("sbForm.type"));
		toggles(type, () => stringsAt(draft, "type"), (l) => (draft.type = l), CREATURE_TYPES.map((t) => [t, tk(`statblock.type.${t}`)]));
		tags(row(body, T("sbForm.subtype")), draft, "subtype");

		// Enjambre: la casilla muestra el tamaño de sus criaturas; al desmarcarla, se borra.
		const swarmRow = row(body);
		const swarmBox = body.createDiv("strakes-sb-subfield");
		const warn = swarmBox.createDiv({ cls: "strakes-sb-warning" });
		let swarmOn = stringsAt(draft, "swarm_creature_size").length > 0;
		const showSwarm = () => swarmBox.toggleClass("is-hidden", !swarmOn);
		check(
			swarmRow,
			T("sbForm.swarm"),
			() => swarmOn,
			(v) => {
				swarmOn = v;
				if (!v) delete draft.swarm_creature_size;
			},
			showSwarm,
		);
		const csRow = row(swarmBox, T("sbForm.swarmCreatureSize"));
		toggles(csRow, () => stringsAt(draft, "swarm_creature_size"), (l) => (draft.swarm_creature_size = l), SIZES.map((s) => [s, sizeLabels(s)]));
		swarmBox.appendChild(warn);
		refreshers.push((sb) => {
			const idx = (s: string) => (SIZES as readonly string[]).indexOf(s);
			const swarm = Math.min(...sb.size.map(idx));
			const bad = sb.size.length > 0 && sb.swarm_creature_size.some((s) => idx(s) >= swarm);
			warn.setText(bad ? T("sbForm.swarmWarning") : "");
			warn.toggleClass("is-hidden", !bad);
		});
		showSwarm();

		// Alineamiento: se escribe; las frases conocidas se sugieren traducidas y se guardan en inglés.
		const al = row(body, T("sbForm.alignment"));
		const alInput = al.createEl("input", { type: "text", cls: "strakes-sb-input is-wide" });
		const gender = () => {
			const sb = readStatblock(draft, ctx.fallbackName);
			return sb.type.length && sb.type.every((t) => tk(`statblock.type.${t.toLowerCase()}.gender`) === "f") ? "f" : "m";
		};
		alInput.value = typeof draft.alignment === "string" ? alignmentName(draft.alignment, gender()) : "";
		alInput.placeholder = T("sbForm.alignmentPlaceholder");
		const setAlignment = (text: string) => {
			const v = alignmentFromInput(text);
			if (v) draft.alignment = v;
			else delete draft.alignment;
			changed();
		};
		alInput.addEventListener("input", () => setAlignment(alInput.value));
		new OptionSuggest(
			app,
			alInput,
			() => ALIGNMENTS.map((id) => ({ value: id, label: alignmentName(id, gender()) })),
			(_v, label) => setAlignment(label),
		);
	}

	// ------------------------------------------------------------ 2. Defensa y desafío

	{
		const body = section("sbForm.section.defense");
		const grid = body.createDiv("strakes-sb-grid");
		input(row(grid, tk("statblock.ac")), draft, "ac", { kind: "numOrText" });
		input(row(grid, T("sbForm.acNote")), draft, "ac_note", { placeholder: T("sbForm.acNotePlaceholder") });
		input(row(grid, tk("statblock.hp")), draft, "hp", {
			kind: "numOrText",
			computed: (sb) => {
				const avg = sb.hp_formula ? averageHp(sb.hp_formula) : undefined;
				return avg !== undefined ? String(avg) : "";
			},
		});
		input(row(grid, T("sbForm.hpFormula")), draft, "hp_formula", { placeholder: "2d8 + 2" });

		const init = row(body, tk("statblock.initiative"));
		const prof = () => (typeof draft.initiative_proficiency === "string" ? draft.initiative_proficiency : "none");
		const setProf = (v: string) => (v === "none" ? delete draft.initiative_proficiency : (draft.initiative_proficiency = v));
		const ip = check(init, T("sbForm.proficient"), () => prof() !== "none", (v) => setProf(v ? "proficient" : "none"), () => (ie.checked = prof() === "expertise"));
		const ie = check(init, T("sbForm.expertise"), () => prof() === "expertise", (v) => setProf(v ? "expertise" : ip.checked ? "proficient" : "none"), () => (ip.checked = prof() !== "none"));
		input(init, draft, "initiative", { kind: "numOrText", cls: "is-short", computed: (_sb, d) => (typeof d.initiative === "number" ? signed(d.initiative) : "") });

		const speed = objAt(draft, "speed");
		const sp = body.createDiv("strakes-sb-grid");
		for (const s of SPEEDS) input(row(sp, s === "walk" ? T("sbForm.walk") : tk(`statblock.speed.${s}`)), speed, s, { kind: "numOrText", cls: "is-short", placeholder: T("sbForm.feet") });
		boolCheck(row(body), T("sbForm.hover"), draft, "hover");

		const cr = body.createDiv("strakes-sb-grid");
		const crInput = input(row(cr, tk("statblock.cr")), draft, "cr", { cls: "is-short" });
		new OptionSuggest(app, crInput, () => CR_OPTIONS.map((c) => ({ value: c, label: c })), (v) => {
			draft.cr = v;
			changed();
		});
		input(row(cr, tk("statblock.xp")), draft, "xp", { kind: "numOrText", cls: "is-short", computed: (_s, d) => (d.xp !== undefined ? display(d.xp) : "") });
		input(row(cr, tk("statblock.pb")), draft, "pb", { kind: "numOrText", cls: "is-short", computed: (_s, d) => (d.pb !== undefined ? signedValue(d.pb) : "") });
		const lairRow = row(body);
		const lairBox = body.createDiv("strakes-sb-subfield");
		const showLair = () => lairBox.toggleClass("is-hidden", draft.lair !== true);
		boolCheck(lairRow, T("sbForm.lair"), draft, "lair", showLair);
		input(row(lairBox, T("sbForm.xpLair")), draft, "xp_lair", { kind: "numOrText", cls: "is-short", computed: (_s, d) => (d.xpLair !== undefined ? display(d.xpLair) : "") });
		showLair();
	}

	// ------------------------------------------------------------ 3. Características y salvaciones

	{
		const body = section("sbForm.section.abilities");
		const table = body.createDiv("strakes-sb-abilities");
		const saves = objAt(draft, "saves");
		for (const a of ABILITIES) {
			const col = table.createDiv("strakes-sb-ability");
			col.createDiv({ cls: "strakes-sb-ability-name", text: tk(`statblock.ability.${a}`) });
			input(col, draft, a, { kind: "int", cls: "is-short", placeholder: "10" });
			const mod = col.createDiv({ cls: "strakes-sb-computed" });
			refreshers.push((_sb, d) => mod.setText(d.mods[a] !== undefined ? signed(d.mods[a]) : "—"));
			check(
				col,
				tk("statblock.save"),
				() => stringsAt(draft, "save_proficiencies").includes(a),
				(v) => {
					const l = stringsAt(draft, "save_proficiencies").filter((x) => x !== a);
					draft.save_proficiencies = v ? ABILITIES.filter((x) => x === a || l.includes(x)) : l;
				},
			);
			input(col, saves, a, { kind: "numOrText", cls: "is-short", computed: (_sb, d) => (d.saves[a] !== undefined ? signedValue(d.saves[a]) : "") });
		}
	}

	// ------------------------------------------------------------ 4. Competencias y defensas

	{
		const body = section("sbForm.section.proficiencies");
		boolCheck(row(body), T("sbForm.allSkills"), draft, "all_skills");
		const profs = objAt(draft, "skill_proficiencies");
		const values = objAt(draft, "skills");
		const groups = body.createDiv("strakes-sb-skill-groups");
		const collator = new Intl.Collator(currentLanguage());
		for (const a of ABILITIES) {
			const skills = Object.entries(SKILLS)
				.filter(([, ab]) => ab === a)
				.map(([id]) => id)
				.sort((x, y) => collator.compare(tk(`statblock.skill.${x}`), tk(`statblock.skill.${y}`)));
			if (!skills.length) continue;
			const g = groups.createDiv("strakes-sb-skill-group");
			g.createDiv({ cls: "strakes-sb-skill-ability", text: tk(`statblock.ability.${a}`) });
			for (const id of skills) {
				const r = g.createDiv("strakes-sb-skill");
				r.createSpan({ cls: "strakes-sb-skill-name", text: tk(`statblock.skill.${id}`) });
				const p = () => (typeof profs[id] === "string" ? profs[id] : "none");
				const set = (v: string) => (v === "none" ? delete profs[id] : (profs[id] = v));
				const cp = check(r, "", () => p() !== "none", (v) => set(v ? "proficient" : "none"), () => (ce.checked = p() === "expertise"));
				cp.title = T("sbForm.proficient");
				const ce = check(r, "", () => p() === "expertise", (v) => set(v ? "expertise" : cp.checked ? "proficient" : "none"), () => (cp.checked = p() !== "none"));
				ce.title = T("sbForm.expertise");
				input(r, values, id, { kind: "numOrText", cls: "is-short", computed: (_sb, d) => (d.skills[id] !== undefined ? signedValue(d.skills[id]) : "") });
			}
		}
		groups.createDiv({ cls: "strakes-sb-hint", text: T("sbForm.skillsHint") });

		const damageIds = DAMAGE_TYPES as readonly string[];
		const isDamage = (x: string) => damageIds.includes(x.toLowerCase());
		for (const key of ["vulnerabilities", "resistances", "immunities"] as const) {
			const r = row(body, tk(`statblock.${key}`), "is-block");
			toggles(r, () => stringsAt(draft, key), (l) => (draft[key] = l), DAMAGE_TYPES.map((t) => [t, tk(`statblock.damage.${t}`)]));
			tags(r, draft, key, { only: (x) => !isDamage(x), placeholder: T("sbForm.otherText") });
		}
		const conds = row(body, T("sbForm.conditionImmunities"), "is-block");
		const all = allConditions(plugin.settings);
		toggles(
			conds,
			() => stringsAt(draft, "condition_immunities"),
			(l) => (draft.condition_immunities = l),
			all.map((c) => [c.custom ? c.name : c.id, c.name]),
		);

		const senses = objAt(draft, "senses");
		const sg = body.createDiv("strakes-sb-grid");
		for (const s of SENSES) input(row(sg, tk(`statblock.sense.${s}`)), senses, s, { kind: "numOrText", cls: "is-short", placeholder: T("sbForm.feet") });
		tags(row(body, T("sbForm.otherSenses")), draft, "senses_other");
		input(row(body, T("sbForm.passivePerception")), draft, "passive_perception", {
			kind: "numOrText",
			cls: "is-short",
			computed: (_sb, d) => (d.passivePerception !== undefined ? display(d.passivePerception) : ""),
		});
		tags(row(body, tk("statblock.gear")), draft, "gear");
		tags(row(body, tk("statblock.languages")), draft, "languages");
	}

	// ------------------------------------------------------------ 5 y 6. Rasgos, conjuros y acciones

	const RECHARGE: [string, string][] = [
		["", T("sbForm.noRecharge")],
		["6", tk("statblock.recharge6")],
		...["5", "4", "3", "2"].map((n): [string, string] => [n, tk("statblock.recharge", { n })]),
		["short", tk("statblock.rechargeShort")],
		["long", tk("statblock.rechargeLong")],
		["short_or_long", tk("statblock.rechargeShortOrLong")],
	];
	const USES_PER: [string, string][] = [
		["day", T("sbForm.perDay")],
		["short", T("sbForm.perShortRest")],
		["long", T("sbForm.perLongRest")],
	];

	/** Botones de una tarjeta de lista: subir, bajar y quitar. */
	const cardButtons = (card: HTMLElement, list: Obj[], i: number) => {
		const bar = card.createDiv("strakes-sb-card-buttons");
		const btn = (icon: string, label: string, disabled: boolean, run: () => void) => {
			const b = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			if (disabled) b.disabled = true;
			b.addEventListener("click", (e) => {
				e.preventDefault();
				run();
				changed();
				ctx.rerender();
			});
		};
		btn("arrow-up", T("sbForm.moveUp"), i === 0, () => list.splice(i - 1, 0, ...list.splice(i, 1)));
		btn("arrow-down", T("sbForm.moveDown"), i === list.length - 1, () => list.splice(i + 1, 0, ...list.splice(i, 1)));
		btn("trash-2", T("sbForm.remove"), false, () => list.splice(i, 1));
	};
	const addButton = (parent: HTMLElement, label: string, run: () => void) => {
		const b = parent.createEl("button", { cls: "strakes-sb-add", text: label });
		b.addEventListener("click", (e) => {
			e.preventDefault();
			run();
			changed();
			ctx.rerender();
		});
	};

	const entries = (key: EntrySection, extra?: (body: HTMLElement) => void) => {
		const body = section(`statblock.section.${key}`);
		extra?.(body);
		const list = listAt(draft, key);
		list.forEach((e, i) => {
			const card = body.createDiv("strakes-sb-card");
			const top = card.createDiv("strakes-sb-card-top");
			input(top, e, "name", { placeholder: T("sbForm.entryName"), cls: "is-wide" });
			cardButtons(top, list, i);
			const uses = card.createDiv("strakes-sb-grid");
			input(row(uses, T("sbForm.uses")), e, "uses", { kind: "int", cls: "is-short" });
			input(row(uses, T("sbForm.usesLair")), e, "uses_lair", { kind: "int", cls: "is-short" });
			select(row(uses, T("sbForm.usesPer")), USES_PER, () => (typeof e.uses_per === "string" ? e.uses_per : "day"), (v) => (v === "day" ? delete e.uses_per : (e.uses_per = v)));
			select(row(uses, T("sbForm.recharge")), RECHARGE, () => display(e.recharge), (v) => (v ? (e.recharge = /^\d$/.test(v) ? Number(v) : v) : delete e.recharge));
			textarea(card, e, "text").placeholder = T("sbForm.entryText");
		});
		addButton(body, T("sbForm.addEntry"), () => list.push({ name: "", text: "" }));
	};

	entries("traits");

	// Lanzamiento de conjuros: bloques con característica, tipo de uso, listas y texto final.
	{
		const body = section("statblock.section.spellcasting");
		const blocks = listAt(draft, "spellcasting");
		const abilityOptions: [string, string][] = [["", "—"], ...ABILITIES.map((a): [string, string] => [a, tk(`statblock.ability.${a}`)])];
		const useOptions: [string, string][] = [
			["action", T("sbForm.useAction")],
			["bonus_action", T("sbForm.useBonusAction")],
			["reaction", T("sbForm.useReaction")],
			["trait", T("sbForm.useTrait")],
		];
		blocks.forEach((b, i) => {
			const card = body.createDiv("strakes-sb-card");
			const top = card.createDiv("strakes-sb-card-top");
			input(top, b, "name", { placeholder: tk("statblock.spellcastingName"), cls: "is-wide" });
			cardButtons(top, blocks, i);
			const g = card.createDiv("strakes-sb-grid");
			select(row(g, T("sbForm.spellAbility")), abilityOptions, () => display(b.ability), (v) => (v ? (b.ability = v) : delete b.ability));
			select(row(g, T("sbForm.useType")), useOptions, () => (typeof b.use === "string" ? b.use : "action"), (v) => (v === "action" ? delete b.use : (b.use = v)));
			const dc = card.createDiv({ cls: "strakes-sb-hint" });
			refreshers.push((_sb, d) => {
				const a = typeof b.ability === "string" ? (b.ability as Ability) : undefined;
				const mod = a ? d.mods[a] : undefined;
				dc.setText(mod !== undefined && d.pbNum !== undefined ? tk("statblock.spellDc", { dc: 8 + d.pbNum + mod, attack: signed(d.pbNum + mod) }) : "");
			});
			textarea(card, b, "text").placeholder = T("sbForm.spellText");
			tags(row(card, tk("statblock.atWill")), b, "at_will");

			const perDay = listAt(b, "per_day");
			perDay.forEach((p, j) => {
				const r = row(card, T("sbForm.perDayList"), "is-block");
				const line = r.createDiv("strakes-sb-card-top");
				input(line, p, "uses", { kind: "int", cls: "is-short", placeholder: "1" });
				line.createSpan({ text: T("sbForm.perDaySuffix") });
				boolCheck(line, T("sbForm.each"), p, "each");
				cardButtons(line, perDay, j);
				tags(r, p, "spells", { placeholder: T("sbForm.addSpell") });
			});
			const levels = listAt(b, "levels");
			levels.forEach((l, j) => {
				const r = row(card, T("sbForm.levelList"), "is-block");
				const line = r.createDiv("strakes-sb-card-top");
				input(line, l, "level", { kind: "int", cls: "is-short", placeholder: "0" });
				line.createSpan({ text: T("sbForm.slots") });
				input(line, l, "slots", { kind: "int", cls: "is-short" });
				cardButtons(line, levels, j);
				tags(r, l, "spells", { placeholder: T("sbForm.addSpell") });
			});
			const adds = card.createDiv("strakes-sb-card-top");
			addButton(adds, T("sbForm.addPerDay"), () => perDay.push({ uses: 1, spells: [] }));
			addButton(adds, T("sbForm.addLevel"), () => levels.push({ level: levels.length ? Math.max(...levels.map((x) => Number(x.level) || 0)) + 1 : 0, spells: [] }));
			textarea(card, b, "footer").placeholder = T("sbForm.footer");
		});
		addButton(body, T("sbForm.addSpellcasting"), () => blocks.push({ name: "" }));
	}

	entries("actions");
	entries("bonus_actions");
	entries("reactions");
	entries("legendary_actions", (body) => {
		const g = body.createDiv("strakes-sb-grid");
		input(row(g, T("sbForm.legendaryUses")), draft, "legendary_uses", { kind: "int", cls: "is-short", placeholder: "3" });
		input(row(g, T("sbForm.legendaryUsesLair")), draft, "legendary_uses_lair", { kind: "int", cls: "is-short" });
		const r = row(body, T("sbForm.legendaryHeader"), "is-block");
		textarea(r, draft, "legendary_header", (sb) => legendaryIntro({ ...sb, legendary_header: "" }));
	});
	entries("mythic_actions", (body) => {
		const r = row(body, T("sbForm.mythicHeader"), "is-block");
		textarea(r, draft, "mythic_header");
	});

	// ------------------------------------------------------------ 7. Otros datos

	{
		const body = section("sbForm.section.other");
		body.createDiv({ cls: "strakes-sb-hint", text: T("sbForm.otherHint") });
		const g = body.createDiv("strakes-sb-grid");
		input(row(g, T("sbForm.source")), draft, "source");
		input(row(g, T("sbForm.page")), draft, "page", { kind: "int", cls: "is-short" });
		const label = (prefix: string, ids: string[]) => (x: string) => (ids.includes(x.toLowerCase()) ? tk(`${prefix}.${x.toLowerCase()}`) : x);
		tags(row(body, T("sbForm.habitat")), draft, "habitat", {
			label: label("sbForm.habitatName", HABITATS),
			suggest: () => HABITATS.map((h) => ({ value: h, label: tk(`sbForm.habitatName.${h}`) })),
		});
		tags(row(body, T("sbForm.treasure")), draft, "treasure", {
			label: label("sbForm.treasureName", TREASURES),
			suggest: () => TREASURES.map((h) => ({ value: h, label: tk(`sbForm.treasureName.${h}`) })),
		});
	}

	refresh();
}
