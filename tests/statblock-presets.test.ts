// 1.4, paso 8: presets de presentación de los statblocks (qué se muestra, orden, columnas y metros) y la Base de bestiario.
import { readStatblock } from "../src/statblock/data";
import { statblockLayout } from "../src/statblock/layout";
import { statblockColumns } from "../src/statblock/render";
import { bestiaryBaseYaml } from "../src/statblock/bestiary";
import {
	allPresets,
	BUILTIN_PRESET,
	copyPreset,
	defaultPreset,
	freePresetName,
	normalizePreset,
	presetFor,
	STATBLOCK_ITEMS,
	StatblockPreset,
} from "../src/statblock/presets";
import { setTranslateContent } from "../src/i18n";
import { setLocale, t } from "./helpers";

setLocale("en");
setTranslateContent(true);
const catalog = { customConditions: [], conditionOverrides: {} };
const mage = {
	statblock: "dnd5e-2024",
	name: "Mage",
	size: "medium",
	type: "humanoid",
	ac: 15,
	hp_formula: "18d8",
	speed: { walk: 30 },
	cr: "6",
	lair: true,
	dex: 14,
	int: 17,
	wis: 12,
	save_proficiencies: ["int"],
	skill_proficiencies: { arcana: "expertise" },
	gear: ["Wand"],
	senses: { darkvision: 60 },
	languages: ["Common"],
	actions: [{ name: "Arcane Burst", text: "Attack." }],
	legendary_actions: [{ name: "Blink", text: "Teleports." }],
};
const preset = (over: Partial<StatblockPreset>): StatblockPreset => ({ ...BUILTIN_PRESET, id: "p1", name: "Test", ...over });
const lay = (p: StatblockPreset, fm: Record<string, unknown> = mage) => statblockLayout(readStatblock(fm, "Mage"), { preset: p, catalog });
const settings = (presets: StatblockPreset[], def = "dnd5e-2024") => ({ statblockPreset: def, statblockPresets: presets });

// ---------- «D&D 2024» ----------
{
	const l = lay(BUILTIN_PRESET);
	t("D&D 2024: todas las partes, en el orden de siempre", l.order, [...STATBLOCK_ITEMS]);
	t("D&D 2024: cada línea sabe qué parte es", l.lines.map((x) => x.item), ["skills", "gear", "senses", "languages", "challenge"]);
	t("D&D 2024: con iniciativa, BC, salvaciones, percepción pasiva, VD y PX", [l.top[0][1]?.label, l.top[1][1]?.label, l.saves, l.lines[2].value, l.lines[4].value], [
		"Initiative",
		"PB",
		true,
		"Darkvision 60 ft.; Passive Perception 11",
		"6 (XP 2300, or 2900 in Lair)",
	]);
	t("D&D 2024: introducción de las acciones legendarias", !!l.sections.find((s) => s.key === "legendary_actions")?.intro, true);
}

// ---------- Ocultar ----------
{
	const l = lay(preset({ hidden: ["initiative", "pb", "saves", "passive_perception", "xp_lair", "legendary_header"] }));
	t("ocultos: iniciativa y BC (la casilla queda vacía, sin mover la otra)", l.top.map((r) => r.map((c) => c?.label ?? null)), [["AC", null], ["HP", null]]);
	t("ocultos: fila de salvaciones", l.saves, false);
	t("ocultos: percepción pasiva (los sentidos se quedan)", l.lines.find((x) => x.item === "senses")?.value, "Darkvision 60 ft.");
	t("ocultos: PX en la guarida", l.lines.find((x) => x.item === "challenge")?.value, "6 (XP 2300)");
	t("ocultos: introducción legendaria (las casillas se quedan)", [l.sections.find((s) => s.key === "legendary_actions")?.intro, !!l.sections.find((s) => s.key === "legendary_actions")?.boxes], [undefined, true]);
}
{
	const l = lay(preset({ hidden: ["gear", "senses", "languages"] }));
	t("ocultos enteros: Equipo, Sentidos e Idiomas salen del orden", ["gear", "senses", "languages"].map((x) => l.order.includes(x as never)), [false, false, false]);
}
t("VD oculto: queda la línea de PX", lay(preset({ hidden: ["cr"] })).lines.find((x) => x.item === "challenge"), { item: "challenge", label: "XP", value: "2300, or 2900 in Lair", field: "xp" });
t("VD y PX ocultos: sin línea de Desafío", lay(preset({ hidden: ["cr", "xp"] })).lines.some((x) => x.item === "challenge"), false);
t("PX oculto: solo el VD", lay(preset({ hidden: ["xp"] })).lines.find((x) => x.item === "challenge")?.value, "6");

// ---------- Orden, metros y columnas ----------
{
	const order = [...STATBLOCK_ITEMS].filter((x) => x !== "challenge");
	order.splice(1, 0, "challenge");
	t("orden propio: el Desafío tras el nombre", lay(preset({ order })).order.slice(0, 3), ["header", "challenge", "defense"]);
}
t("metros del preset", lay(preset({ metric: true })).speed, "30 ft. (9 m)");
t("columnas: las del statblock mandan; si no, las del preset", [statblockColumns(readStatblock({ ...mage, columns: 1 }, "M"), 2), statblockColumns(readStatblock(mage, "M"), 2)], [1, 2]);

// ---------- Leer y elegir presets ----------
{
	const order = normalizePreset({ id: "a", name: "A", order: ["actions", "header", "header", "nope"] })?.order ?? [];
	t("leer: partes desconocidas fuera, repetidas una vez, las que faltan tras la que las precede", [order.length, order.slice(0, 7)], [STATBLOCK_ITEMS.length, ["actions", "bonus_actions", "reactions", "legendary_actions", "lair_actions", "header", "defense"]]);
}
t("leer: ocultos válidos sin repetir, columnas y metros", ((p) => [p?.hidden, p?.columns, p?.metric])(normalizePreset({ id: "a", name: "A", hidden: ["xp", "xp", "bad"], columns: 2 })), [["xp"], 2, false]);
t("leer: sin id, o con el de «D&D 2024», no vale", [normalizePreset({ name: "x" }), normalizePreset({ id: "dnd5e-2024" }), normalizePreset("x")], [null, null, null]);
{
	const compact = preset({ id: "c", name: "Compacto" });
	const s = settings([compact], "c");
	t("preset de la nota por nombre (sin distinguir mayúsculas)", presetFor(s, "compacto").id, "c");
	t("sin preset en la nota: el general", presetFor(s, "").id, "c");
	t("preset que ya no existe: el general", presetFor(s, "Borrado").id, "c");
	t("general que ya no existe: «D&D 2024»", defaultPreset(settings([], "c")).id, "dnd5e-2024");
	t("lista: «D&D 2024» primero", allPresets(s).map((p) => p.name), ["D&D 2024", "Compacto"]);
	t("nombre libre: con número si está ocupado", [freePresetName(s, "Compacto"), freePresetName(s, "d&d 2024"), freePresetName(s, "Compacto", "c"), freePresetName(s, "Nuevo")], ["Compacto 2", "d&d 2024 2", "Compacto", "Nuevo"]);
	const copy = copyPreset(s, compact, "Compacto");
	t("copia: otro id y nombre, mismos datos (no compartidos)", [copy.id !== "c", copy.name, copy.order !== compact.order, copy.order.join() === compact.order.join()], [true, "Compacto 2", true, true]);
}

// ---------- Base de bestiario ----------
{
	const yaml = bestiaryBaseYaml();
	t("Base: filtra por la propiedad statblock", yaml.includes('    - file.hasProperty("statblock")'), true);
	t("Base: el VD como número para ordenar", yaml.includes(`  cr_number: 'if(cr, if(cr.toString().contains("/"), number(cr.toString().split("/")[0]) / number(cr.toString().split("/")[1]), number(cr)))'`), true);
	t("Base: columnas en orden", yaml.split("    order:\n")[1].split("    sort:")[0].trim().split("\n").map((x) => x.trim()), [
		"- file.name",
		"- cr",
		"- formula.cr_number",
		"- type",
		"- size",
		"- alignment",
		"- habitat",
		"- source",
	]);
	t("Base: nombres de columna en el idioma de la interfaz", yaml.includes('  formula.cr_number:\n    displayName: "CR (number)"'), true);
}
