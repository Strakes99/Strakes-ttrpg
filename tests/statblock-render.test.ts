// 1.4: statblocks. Lectura de las propiedades, cálculos y maqueta (layout.ts) del statblock dibujado.
import { abilityMod, averageHp, derive, lairXpForCr, pbForCr, xpForCr } from "../src/statblock/compute";
import { nameFromNote, readStatblock } from "../src/statblock/data";
import { alignmentName, creatureRef, hasBoxes, headerLine, speedLine, StatblockLayout, statblockLayout } from "../src/statblock/layout";
import { applyUsed, findStatblockBlock, parseUsed, remapListKeys, removeMove, serializeUsed, swapMove, useKey, withBlockBody } from "../src/statblock/uses";
import { BUILTIN_PRESET, StatblockPreset } from "../src/statblock/presets";
import { setTranslateContent, T } from "../src/i18n";
import { conditionById } from "../src/initiative/conditions";
import { setLocale, t } from "./helpers";

const catalog = { customConditions: [], conditionOverrides: {} };
const opts = { preset: BUILTIN_PRESET as StatblockPreset, catalog };
const sb = (fm: Record<string, unknown>, name = "Criatura") => readStatblock({ statblock: "dnd5e-2024", ...fm }, name);
const lay = (fm: Record<string, unknown>, metric = false) => statblockLayout(sb(fm), { ...opts, preset: { ...BUILTIN_PRESET, metric } });
/** Con lo gastado escrito en el bloque de la nota («clave: n» por línea). */
const layUsed = (fm: Record<string, unknown>, used: string) => {
	const r = sb(fm);
	applyUsed(r, parseUsed(used));
	return statblockLayout(r, opts);
};
/** El valor de una línea («Habilidades», «Sentidos»…), o undefined si no está. */
const line = (l: StatblockLayout, label: string) => l.lines.find((x) => x.label === label)?.value;
/** Todas las entradas (Markdown) de las secciones, juntas. */
const entries = (l: StatblockLayout) => l.sections.flatMap((x) => (x.intro ? [x.intro, ...x.entries.map((e) => e.markdown)] : x.entries.map((e) => e.markdown))).join("\n");
const has = (text: string, part: string) => text.includes(part);

/** El Aboleth de 2024, como lo guardaría el plugin. */
const aboleth = {
	name: "Aboleth",
	size: "large",
	type: "aberration",
	alignment: "Lawful Evil",
	ac: 17,
	initiative_proficiency: "proficient",
	hp_formula: "20d10 + 40",
	speed: { walk: 10, swim: 40 },
	cr: "10",
	lair: true,
	str: 21,
	dex: 9,
	con: 15,
	int: 18,
	wis: 15,
	cha: 18,
	save_proficiencies: ["dex", "con", "int", "wis"],
	skill_proficiencies: { history: "expertise", perception: "expertise" },
	senses: { darkvision: 120 },
	languages: ["Deep Speech", "telepathy 120 ft."],
	traits: [{ name: "Legendary Resistance", text: "If the aboleth fails a saving throw, it can choose to succeed instead.", uses: 3, uses_lair: 4 }],
	actions: [
		{ name: "Multiattack", text: "The aboleth makes two Tentacle attacks." },
		{ name: "Consume Memories", text: "Wisdom Saving Throw.", recharge: 5 },
	],
	legendary_uses: 3,
	legendary_uses_lair: 4,
	legendary_actions: [{ name: "Lash", text: "The aboleth makes one Tentacle attack." }],
};

// ---------- Cálculos ----------
t("modificador: 9 → −1, 21 → +5, 10 → 0", [abilityMod(9), abilityMod(21), abilityMod(10)], [-1, 5, 0]);
t("BC por VD: 4 → 2, 5 → 3, 10 → 4, 17 → 6, 30 → 9, 1/2 → 2", [pbForCr("4"), pbForCr("5"), pbForCr("10"), pbForCr("17"), pbForCr("30"), pbForCr("1/2")], [2, 3, 4, 6, 9, 2]);
t("PX por VD: 10 → 5900, 1/4 → 50, texto → nada", [xpForCr("10"), xpForCr("1/4"), xpForCr("especial")], [5900, 50, undefined]);
t("PX en la guarida: los del VD siguiente (10 → 7200, 24 → 75000)", [lairXpForCr("10"), lairXpForCr("24")], [7200, 75000]);
t("media de PG: 20d10 + 40 → 150, 2d8+2 → 11, 3d6 − 1 → 9", [averageHp("20d10 + 40"), averageHp("2d8+2"), averageHp("3d6 − 1")], [150, 11, 9]);
t("media de PG: fórmula que no se entiende → nada", averageHp("muchos"), undefined);
{
	const d = derive(sb(aboleth));
	t("Aboleth: PG de la fórmula, BC 4, PX 5900 y 7200 en la guarida", [d.hp, d.pb, d.xp, d.xpLair], [150, 4, 5900, 7200]);
	t("Aboleth: iniciativa = Des (−1) + BC (competencia) = +3", d.initiative, 3);
	t("Aboleth: salvaciones (Des +3, Con +6, Fue +5 sin competencia)", [d.saves.dex, d.saves.con, d.saves.str], [3, 6, 5]);
	t("Aboleth: pericia en Historia (+4 + 8) y Percepción (+2 + 8)", [d.skills.history, d.skills.perception], [12, 10]);
	t("Aboleth: Percepción pasiva 20", d.passivePerception, 20);
}
{
	const d = derive(sb({ ...aboleth, pb: 5, xp: 6000, saves: { dex: "+9" }, skills: { history: 15 }, passive_perception: 25, initiative: 7 }));
	t("lo escrito a mano manda (BC, PX, salvación, habilidad, pasiva, iniciativa)", [d.pb, d.xp, d.saves.dex, d.skills.history, d.passivePerception, d.initiative], [5, 6000, 9, 15, 25, 7]);
}
t("sin Sabiduría ni Percepción, no hay Percepción pasiva", derive(sb({ str: 10 })).passivePerception, undefined);

// ---------- Lectura ----------
t("nombre de la nota sin prefijo ni sufijo", [nameFromNote("ST-Goblin", "ST-", ""), nameFromNote("Goblin (sb)", "", " (sb)"), nameFromNote("ST-", "ST-", "")], ["Goblin", "Goblin", "ST-"]);
t("sin name, el de la nota", sb({}, "Goblin").name, "Goblin");
{
	const r = sb({ size: ["Medium", "enorme"], ac: "14 + the spell's level", hp: "12", str: "abc", traits: [{ name: "" }, "x", { name: "Rasgo", uses: "2" }] });
	t("lectura tolerante: tamaños desconocidos fuera, números en texto, entradas vacías fuera", [r.size, r.ac, r.hp, r.scores.str, r.entries.traits.length, r.entries.traits[0].uses], [["medium"], "14 + the spell's level", 12, undefined, 1, 2]);
}

// ---------- Cabecera ----------
setLocale("es");
t("es: concordancia de género (Aberración Grande, Legal Malvada)", headerLine(sb(aboleth)), "Aberración Grande, Legal Malvada");
t("es: masculino (Dragón Gargantuesco (Metallic), Legal Bueno)", headerLine(sb({ size: "gargantuan", type: "dragon", subtype: ["Metallic"], alignment: "Lawful Good" })), "Dragón Gargantuesco (Metallic), Legal Bueno");
t(
	"es: varios tipos con «o» y punto y coma antes del alineamiento",
	headerLine(sb({ size: "large", type: ["celestial", "fey", "fiend"], alignment: "Neutral" })),
	"Celestial, Feérico o Infernal Grande; Neutral",
);
t("es: enjambre", headerLine(sb({ size: "medium", type: "beast", swarm_creature_size: "tiny", alignment: "Unaligned" })), "Enjambre Mediano de Bestias Diminutas, Sin Alineamiento");
t("es: campos vacíos sin paréntesis ni coma", [headerLine(sb({ type: "undead" })), headerLine(sb({ alignment: "Chaotic Evil" })), headerLine(sb({}))], ["Muerto Viviente", "Caótico Malvado", ""]);
t("es: alineamientos «Any…» y desconocidos", [alignmentName("Any Non-Good Alignment", "f"), alignmentName("any chaotic", "m"), alignmentName("Strahd's whim", "m")], ["Cualquier Alineamiento No Bueno", "Cualquier Alineamiento Caótico", "Strahd's whim"]);
t("es: tipo desconocido, tal cual", headerLine(sb({ size: "small", type: "Kobold-thing" })), "Kobold-thing Pequeño");
setLocale("en");
t("en: Gargantuan Dragon (Metallic), Lawful Good", headerLine(sb({ size: "gargantuan", type: "dragon", subtype: "Metallic", alignment: "Lawful Good" })), "Gargantuan Dragon (Metallic), Lawful Good");
t("en: Large Celestial, Fey, or Fiend; Neutral", headerLine(sb({ size: "large", type: ["celestial", "fey", "fiend"], alignment: "neutral" })), "Large Celestial, Fey, or Fiend; Neutral");
t("en: Medium Swarm of Tiny Beasts", headerLine(sb({ size: "medium", type: "beast", swarm_creature_size: "tiny" })), "Medium Swarm of Tiny Beasts");

// ---------- Velocidad y distancias ----------
t("en: caminando primero y el resto por orden alfabético, con (hover)", speedLine(sb({ speed: { fly: 80, walk: 60, burrow: 40, climb: 60 }, hover: true }), false), "60 ft., Burrow 40 ft., Climb 60 ft., Fly 80 ft. (hover)");
t("en: en metros entre paréntesis", speedLine(sb({ speed: { walk: 25 } }), true), "25 ft. (7.5 m)");
setLocale("es");
t("es: orden alfabético del idioma y metros con coma", speedLine(sb({ speed: { walk: 25, swim: 40, fly: 30 } }), true), "25 pies (7,5 m), Nadar 40 pies (12 m), Volar 30 pies (9 m)");
t("es: velocidad en texto, tal cual", speedLine(sb({ speed: { walk: "30 ft. (only in water)" } }), false), "30 ft. (only in water)");

// ---------- Callout completo ----------
{
	const l = lay(aboleth);
	t("es: nombre y línea de tipo", [l.name, l.subtitle], ["Aboleth", "Aberración Grande, Legal Malvada"]);
	t(
		"es: bloque superior: CA | Iniciativa; PG | BC (el BC bajo la iniciativa)",
		l.top,
		[
			[{ label: "CA", value: "17", field: "ac" }, { label: "Iniciativa", value: "+3 (13)", field: "initiative" }],
			[{ label: "PG", value: "150 (20d10 + 40)", field: "hp" }, { label: "BC", value: "+4", field: "pb" }],
		],
	);
	t("es: velocidad aparte, a lo ancho", l.speed, "10 pies, Nadar 40 pies");
	t("es: características (abreviaturas, puntuación, mod. con signo menos tipográfico y salvación)", l.abilities?.[1], { ability: "dex", label: "Des", score: "9", mod: "\u22121", save: "+3" });
	t("es: salvaciones", l.abilities?.map((a) => a.save), ["+5", "+3", "+6", "+8", "+6", "+4"]);
	t("es: habilidades en orden alfabético", line(l, "Habilidades"), "Historia +12, Percepción +10");
	t("es: sentidos con la Percepción pasiva", line(l, "Sentidos"), "Visión en la oscuridad 120 pies; Percepción pasiva 20");
	t("es: idiomas", line(l, "Idiomas"), "Deep Speech, telepathy 120 ft.");
	t("es: VD con los PX y la guarida, al final y sin el BC", l.lines[l.lines.length - 1], { item: "challenge", label: "VD", value: "10 (PX 5900, o 7200 en su guarida)", field: "cr" });
	t("es: sin líneas vacías de vulnerabilidades, resistencias, inmunidades ni equipo", ["Vulnerabilidades", "Resistencias", "Inmunidades", "Equipo"].some((w) => line(l, w) !== undefined), false);
	t("es: orden de las líneas", l.lines.map((x) => x.label), ["Habilidades", "Sentidos", "Idiomas", "VD"]);
	const text = entries(l);
	t("es: entrada en negrita y cursiva con dos puntos, usos en la guarida", has(text, "***Legendary Resistance (3/día, o 4/día en su guarida):*** If the aboleth"), true);
	t("es: recarga", has(text, "***Consume Memories (Recarga 5–6):*** Wisdom Saving Throw."), true);
	t("es: secciones en orden", l.sections.map((x) => x.title), ["Rasgos", "Acciones", "Acciones Legendarias"]);
	t(
		"es: introducción generada de las acciones legendarias",
		has(l.sections[2].intro ?? "", "Usos de acción legendaria: 3 (4 en su guarida). Inmediatamente después del turno de otra criatura, el aboleth puede gastar un uso para realizar una de las siguientes acciones. El aboleth recupera todos"),
		true,
	);
}
t("es: sin idiomas, «Idiomas —»", line(lay({ str: 10 }), "Idiomas"), "—");
{
	const l = lay({});
	t("es: sin nada, solo el nombre y los idiomas", [l.name, l.subtitle, l.top, l.speed, l.abilities, l.lines, l.sections], ["Criatura", "", [], "", null, [{ item: "languages", label: "Idiomas", value: "—", field: "languages" }], []]);
}
t("es: sin CA, la iniciativa sigue en su columna", lay({ dex: 14 }).top, [[null, { label: "Iniciativa", value: "+2 (12)", field: "initiative" }]]);
t("es: sin VD, solo los PX escritos", lay({ xp: 50 }).lines.at(-1), { item: "challenge", label: "PX", value: "50", field: "xp" });
t("es: VD sin PX (texto)", lay({ cr: "especial" }).lines.at(-1), { item: "challenge", label: "VD", value: "especial", field: "cr" });
t("es: sentidos en metros", line(lay({ senses: { blindsight: 60 }, wis: 10 }, true), "Sentidos"), "Vista ciega 60 pies (18 m); Percepción pasiva 10");
t("es: CA con nota conocida, traducida", lay({ ac: 13, ac_note: "chain shirt" }).top[0][0], { label: "CA", value: "13 (camisote de mallas)", field: "ac" });
t("es: nota de CA con varias partes, sin distinguir mayúsculas", lay({ ac: 20, ac_note: "Plate Armor, shield" }).top[0][0]?.value, "20 (armadura de placas, escudo)");
t("es: nota de CA desconocida, tal cual", lay({ ac: 15, ac_note: "15 with Mage Armor" }).top[0][0]?.value, "15 (15 with Mage Armor)");
t("es: sentidos de texto conocidos, traducidos", line(lay({ senses: { blindsight: 30 }, senses_other: ["echolocation", "smells fear"] }), "Sentidos"), "Vista ciega 30 pies, ecolocalización, smells fear");
t("es: inmunidades de daño y condiciones juntas, con «;»", line(lay({ immunities: ["fire", "poison"], condition_immunities: ["charmed", "Mi condición"] }), "Inmunidades"), "Fuego, Veneno; {@condition charmed||Hechizado}, Mi condición");
t("es: resistencias en texto (2014), tal cual", line(lay({ resistances: ["cold", "bludgeoning from nonmagical attacks"] }), "Resistencias"), "Frío, bludgeoning from nonmagical attacks");
t("es: el paréntesis propio del nombre se junta con «;»", entries(lay({ actions: [{ name: "Fell Glare (Fiend Only)", text: "x", recharge: "long" }] })), "***Fell Glare (Fiend Only; Se recarga tras un descanso largo):*** x");
t("es: marcas de enlace, se conservan (el dibujo las vuelve enlaces); las demás, su texto", entries(lay({ actions: [{ name: "Garra", text: "Queda {@condition Grappled|XPHB} con {@dice 1d6}." }] })), "***Garra:*** Queda {@condition Grappled|XPHB} con 1d6.");
t("es: entrada de varios párrafos, con salto forzado", entries(lay({ reactions: [{ name: "A", text: "Uno.\n\nDos." }] })), "***A:*** Uno.  \n  \nDos.");
t("es: Nombre propio, sin artículo", creatureRef(sb({ name: "Strahd", named: true })), "Strahd");
t("es: nombre en el texto con su artículo", [creatureRef(sb({ name: "Arpía", short_name: "la arpía" })), creatureRef(sb({ name: "Goblin Jefe", short_name: "goblin" }))], ["la arpía", "el goblin"]);
t("es: encabezado legendario escrito, en lugar del generado", lay({ legendary_header: "Cabecera propia.", legendary_actions: [{ name: "A", text: "b" }] }).sections[0].intro, "Cabecera propia.");
t("es: columnas del statblock (1, 2 o las de los ajustes)", [sb({ columns: 2 }).columns, sb({ columns: "1" }).columns, sb({ columns: 3 }).columns, sb({}).columns], [2, 1, undefined, undefined]);
{
	const l = lay({
		cha: 16,
		cr: "5",
		spellcasting: [
			{
				name: "Spellcasting",
				ability: "cha",
				text: "The creature casts one of the following spells.",
				at_will: ["{@spell Mage Hand|XPHB}", "Prestidigitation"],
				per_day: [{ uses: 1, each: true, spells: ["Fireball", "Fly"] }],
				levels: [{ level: 1, slots: 4, spells: ["Shield"] }, { level: 0, spells: ["Light"] }],
				footer: "Pie.",
			},
			{ name: "Counterspell (2/Day)", ability: "cha", text: "x", per_day: { uses: 2, spells: ["Counterspell"] } },
		],
	});
	const text = entries(l);
	t("es: sección de conjuros", l.sections.map((x) => x.title), ["Lanzamiento de Conjuros"]);
	const spell = l.sections[0].entries[0].spell;
	t("es: nombre y texto del bloque de conjuros", l.sections[0].entries[0].markdown, "***Spellcasting:*** The creature casts one of the following spells.");
	t("es: CD y bonificador de ataque aparte, como etiqueta y valor", spell?.stats, [
		{ label: "CD de salvación de conjuros", value: "14" },
		{ label: "Bonificador de ataque con conjuros", value: "+6" },
	]);
	t(
		"es: a voluntad, al día cada uno y por niveles (trucos primero), con los nombres sin marcas",
		spell?.lines.map((x) => [x.label, x.spells.map((y) => y.name).join(", ")]),
		[
			["A voluntad", "Mage Hand, Prestidigitation"],
			["1/día cada uno", "Fireball, Fly"],
			["Trucos", "Light"],
			["Nivel 1 (4 espacios)", "Shield"],
		],
	);
	t("es: casillas: al día «cada uno», una lista por conjuro; espacios de nivel; ni a voluntad ni trucos", spell?.lines.map((x) => [x.boxes?.total ?? 0, x.spells.map((y) => y.boxes?.total ?? 0)]), [
		[0, [0, 0]],
		[0, [1, 1]],
		[0, [0]],
		[4, [0]],
	]);
	t("es: sin tipo de uso (se quitó use): solo el paréntesis propio del nombre", has(text, "***Counterspell (2/Day):*** x"), true);
	t("es: texto final", spell?.footer, "Pie.");
	t("es: al día sin «cada uno»: casillas tras la etiqueta", l.sections[0].entries[1].spell?.lines[0].boxes, { total: 2, used: 0, ref: { kind: "perDay", block: 1, index: 0 } });
}
{
	const l = lay({ all_skills: true, str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10, cr: "1", skill_proficiencies: { stealth: "proficient" } });
	t("es: mostrar todas las habilidades: las 18", l.allSkills?.length, 18);
	t("es: con todas, no hay línea de Habilidades", line(l, "Habilidades"), undefined);
	t("es: habilidades en orden alfabético", l.allSkills?.slice(0, 2), [{ label: "Acrobacias", value: "+2" }, { label: "Atletismo", value: "+0" }]);
	t("es: con competencia, el BC", l.allSkills?.find((x) => x.label === "Sigilo")?.value, "+4");
}
// ---------- Casillas de usos (paso 4); lo gastado, en el bloque de la nota ----------
{
	const l = layUsed(
		{
			traits: [
				{ name: "", text: "" },
				{ name: "Resistencia legendaria", text: "x", uses: 3, uses_lair: 4 },
			],
			actions: [
				{ name: "Aliento", text: "x", recharge: 5 },
				{ name: "Garra", text: "x" },
				{ name: "Dominar", text: "x", uses: 2 },
			],
		},
		"traits.1: 2\nactions.0: 1\nactions.2: 7",
	);
	const [legendary] = l.sections[0].entries;
	const [breath, claw, dominate] = l.sections[1].entries;
	t("casillas: usos y los de la guarida aparte; posición real en la nota (la entrada vacía cuenta)", legendary.boxes, { total: 4, used: 2, lairFrom: 3, ref: { kind: "entry", section: "traits", index: 1 } });
	t("casillas: una recarga es una sola casilla", breath.boxes, { total: 1, used: 1, recharge: true, ref: { kind: "entry", section: "actions", index: 0 } });
	t("casillas: sin usos ni recarga, ninguna", claw.boxes, undefined);
	t("casillas: lo gastado nunca pasa del total", dominate.boxes?.used, 2);
	t("destinos de la vista previa: entradas y secciones", [legendary.target, breath.target, l.sections.map((x) => x.key)], ["entry:traits:1", "entry:actions:0", ["traits", "actions"]]);
	t("hasBoxes: con casillas sí, sin ellas no", [hasBoxes(l), hasBoxes(lay({ actions: [{ name: "Garra", text: "x" }] }))], [true, false]);
	t("lo gastado en las propiedades ya no cuenta (solo el bloque)", lay({ actions: [{ name: "A", text: "x", uses: 2, used: 2 }] }).sections[0].entries[0].boxes?.used, 0);
}
{
	const legendary = (fm: Record<string, unknown>, used = "") => layUsed({ legendary_actions: [{ name: "Lash", text: "x" }], ...fm }, used).sections[0].boxes;
	t("acciones legendarias: una casilla por uso, las de la guarida aparte", legendary({ legendary_uses: 3, legendary_uses_lair: 4 }, "legendary: 1"), { total: 4, used: 1, lairFrom: 3, ref: { kind: "legendary" } });
	t("acciones legendarias: sin usos escritos, 3 casillas (el valor por defecto)", legendary({}), { total: 3, used: 0, ref: { kind: "legendary" } });
	t("acciones legendarias: la introducción generada también dice 3", lay({ legendary_actions: [{ name: "Lash", text: "x" }] }).sections[0].intro?.startsWith("Usos de acción legendaria: 3."), true);
	t("acciones legendarias: hasBoxes las cuenta", hasBoxes(lay({ legendary_actions: [{ name: "Lash", text: "x" }] })), true);
}
{
	t(
		"claves de las casillas",
		[
			useKey({ kind: "legendary" }),
			useKey({ kind: "entry", section: "bonus_actions", index: 2 }),
			useKey({ kind: "block", block: 1 }),
			useKey({ kind: "perDay", block: 0, index: 1 }),
			useKey({ kind: "perDay", block: 0, index: 1, spell: "Fog Cloud" }),
			useKey({ kind: "level", block: 0, index: 3 }),
		],
		["legendary", "bonus_actions.2", "spellcasting.1", "spellcasting.0.per_day.1", "spellcasting.0.per_day.1/Fog Cloud", "spellcasting.0.levels.3"],
	);
	t("leer y escribir lo gastado (lo raro se ignora; 0 no se escribe)", [[...parseUsed("traits.1: 2\nbasura\nlegendary: 0\nx: -1\nspellcasting.0.per_day.0/Fog Cloud: 1")], serializeUsed(new Map([["a", 1], ["b", 0]]))], [
		[["traits.1", 2], ["spellcasting.0.per_day.0/Fog Cloud", 1]],
		"a: 1",
	]);
	const r = sb({ spellcasting: [{ per_day: [{ uses: 1, spells: ["X"] }, { uses: 1, each: true, spells: ["Y", "Z"] }], levels: [{ level: 2, slots: 1, spells: ["W"] }] }] });
	applyUsed(r, parseUsed("spellcasting.0.per_day.0: 1\nspellcasting.0.per_day.1/Y: 1\nspellcasting.0.levels.0: 1"));
	t("aplicar lo gastado: listas al día (con «cada uno», por conjuro) y niveles", [r.spellcasting[0].per_day.map((p) => [p.used, p.usedEach]), r.spellcasting[0].levels[0].used], [[[1, {}], [0, { Y: 1 }]], 1]);
	const note = "---\nstatblock: dnd5e-2024\n---\nTexto\n```strakes-statblock\n```\nMás";
	t("bloque de la nota: se encuentra", findStatblockBlock(note), { open: 4, close: 5, body: "" });
	const written = withBlockBody(note, () => "traits.0: 1\nlegendary: 2");
	t("bloque de la nota: se escribe dentro, sin tocar lo demás", written, "---\nstatblock: dnd5e-2024\n---\nTexto\n```strakes-statblock\ntraits.0: 1\nlegendary: 2\n```\nMás");
	t("bloque de la nota: vaciarlo (restablecer usos)", withBlockBody(written, () => ""), note);
	t("nota sin bloque: no se toca", withBlockBody("sin bloque", () => "x: 1"), "sin bloque");
	const spent = new Map([["traits.0", 1], ["traits.2", 3], ["actions.0", 2], ["legendary", 1], ["spellcasting.0", 1], ["spellcasting.1.levels.0", 2], ["spellcasting.1.per_day.0/Fog Cloud", 1], ["spellcasting.10", 1]]);
	t("mover una entrada: lo gastado la sigue (y no toca otras secciones)", [...remapListKeys(spent, "traits", swapMove(2, 1))].slice(0, 4), [["traits.0", 1], ["traits.1", 3], ["actions.0", 2], ["legendary", 1]]);
	t("quitar una entrada: se va lo suyo y las de detrás suben", [...remapListKeys(new Map([["traits.0", 1], ["traits.1", 2], ["traits.2", 3]]), "traits", removeMove(1))], [["traits.0", 1], ["traits.1", 3]]);
	t("mover un bloque de conjuros: con él sus listas y niveles (spellcasting.10 no es el 1)", [...remapListKeys(spent, "spellcasting", swapMove(1, 0))].slice(4), [["spellcasting.1", 1], ["spellcasting.0.levels.0", 2], ["spellcasting.0.per_day.0/Fog Cloud", 1], ["spellcasting.10", 1]]);
	t("quitar un nivel de un bloque: solo ese bloque", [...remapListKeys(new Map([["spellcasting.0.levels.0", 1], ["spellcasting.0.levels.1", 2], ["spellcasting.1.levels.1", 3]]), "spellcasting.0.levels", removeMove(0))], [["spellcasting.0.levels.0", 2], ["spellcasting.1.levels.1", 3]]);
	t("mover una lista al día con «cada uno»", [...remapListKeys(new Map([["spellcasting.0.per_day.0/Entangle", 1]]), "spellcasting.0.per_day", swapMove(0, 1))], [["spellcasting.0.per_day.1/Entangle", 1]]);
}
setLocale("en");
{
	const l = lay(aboleth);
	t("en: CR line with XP and lair, number format", l.lines.at(-1), { item: "challenge", label: "CR", value: "10 (XP 5900, or 7200 in Lair)", field: "cr" });
	t("en: generated legendary intro", has(l.sections[2].intro ?? "", "Legendary Action Uses: 3 (4 in Lair). Immediately after another creature's turn, the aboleth can expend a use"), true);
	t("en: uses", has(entries(l), "***Legendary Resistance (3/Day, or 4/Day in Lair):***"), true);
	t("en: ability abbreviations", l.abilities?.map((a) => a.label), ["Str", "Dex", "Con", "Int", "Wis", "Cha"]);
}
setLocale("es");

// ---------- «Traducir el contenido» desactivado: contenido en inglés, interfaz en español ----------
{
	setLocale("es");
	setTranslateContent(false);
	const l = lay(aboleth);
	t("sin traducir el contenido: cabecera, etiquetas y líneas en inglés", [l.subtitle, l.top[0][0]?.label, line(l, "Senses"), l.lines.at(-1)?.value], [
		"Large Aberration, Lawful Evil",
		"AC",
		"Darkvision 120 ft.; Passive Perception 20",
		"10 (XP 5900, or 7200 in Lair)",
	]);
	t("sin traducir el contenido: secciones y usos en inglés", [l.sections.map((x) => x.title), has(entries(l), "(3/Day, or 4/Day in Lair)")], [["Traits", "Actions", "Legendary Actions"], true]);
	t("sin traducir el contenido: condiciones del SRD en inglés", conditionById("charmed", catalog)?.name, "Charmed");
	t("sin traducir el contenido: la interfaz sigue en español", T("sbForm.name"), "Nombre");
	setTranslateContent(true);
	t("traduciendo el contenido: otra vez en español", [lay(aboleth).subtitle, conditionById("charmed", catalog)?.name], ["Aberración Grande, Legal Malvada", "Hechizado"]);
}
t("números del contenido sin separador de miles (también en español)", lay({ cr: "24", lair: true }).lines.at(-1)?.value, "24 (PX 62000, o 75000 en su guarida)");

// ---------- Acciones de guarida (2026-11-24; sustituyen a las míticas, que se quitaron) ----------
{
	const l = lay({
		legendary_actions: [{ name: "Lash", text: "x" }],
		lair_actions: [{ name: "", text: "The water surges." }, { name: "Grasping Mud", text: "Mud grabs." }],
		lair_actions_header: "On initiative count 20, the creature takes a lair action.",
		mythic_actions: [{ name: "Old", text: "y" }],
	});
	t("guarida: sección al final, tras las legendarias; las míticas ya no existen", l.sections.map((x) => x.key), ["legendary_actions", "lair_actions"]);
	t("guarida: introducción y entradas (sin nombre, en viñeta)", [l.sections[1].intro, l.sections[1].entries.map((e) => e.markdown)], [
		"On initiative count 20, the creature takes a lair action.",
		["- The water surges.", "***Grasping Mud:*** Mud grabs."],
	]);
}

// ---------- Bloques de conjuros con usos propios y sin CD (2026-11-24) ----------
{
	const l = layUsed({ int: 16, cr: "5", spellcasting: [{ name: "Protective Magic", ability: "int", uses: 3, hide_dc: true, text: "Casts {@spell Shield}." }] }, "spellcasting.0: 1");
	const e = l.sections[0].entries[0];
	t("bloque con usos: paréntesis y casillas tras el nombre", [e.markdown, e.boxes], ["***Protective Magic (3/día):*** Casts {@spell Shield}.", { total: 3, used: 1, ref: { kind: "block", block: 0 } }]);
	t("bloque con hide_dc: sin CD ni ataque", e.spell?.stats, undefined);
}
