// 1.4, paso 5: importar statblocks (formato JSON de 5etools). Criaturas inventadas (sin texto de los libros).
import {
	alignmentPhrase,
	bookLabel,
	convertMonster,
	convertText,
	legendaryGroupIndex,
	missingGroup,
	parseEntryName,
} from "../src/statblock/import5e";
import { t } from "./helpers";

const ctx = (groups: unknown[] = []) => ({ groups: legendaryGroupIndex(groups), headings: { regionalEffects: "Regional Effects" } });
const conv = (m: Record<string, unknown>, groups: unknown[] = []) => convertMonster({ name: "Test Beast", source: "XMM", ...m }, ctx(groups));

// ---------- Marcas ----------
t(
	"marcas: ataque, impacto, daño, CD, salvación y fallo, al texto de 2024",
	convertText("{@atkr m} {@hit 7}, reach 5 ft. {@h}9 ({@damage 2d6 + 2}) Slashing damage. {@actSave con} {@dc 13}. {@actSaveFail} Poisoned."),
	"*Melee Attack Roll:* +7, reach 5 ft. *Hit:* 9 (2d6 + 2) Slashing damage. *Constitution Saving Throw:* DC 13. *Failure:* Poisoned.",
);
t("marcas: se conservan condition, creature y spell, sin la fuente", convertText("{@condition Grappled|XPHB} and {@spell Fireball|XPHB} and {@creature wolf||wolves}"), "{@condition Grappled} and {@spell Fireball} and {@creature wolf||wolves}");
t("marcas: texto a mostrar en la tercera parte", convertText("{@variantrule Cone [Area of Effect]|XPHB|Cone} and {@item chain mail|phb}"), "Cone and chain mail");
t("marcas: 2014 (ataque con arma, éxito, respuesta con guion)", convertText("{@atk mw,rw} {@actSaveSuccess} {@actResponse d}"), "*Melee or Ranged Weapon Attack:* *Success:* *Response—*");
t("marcas: libro y aventura, su nombre y no el capítulo", convertText("{@book extreme cold|DMG|5|Extreme Cold} in the {@book Dungeon Master's Guide|DMG}, {@adventure area 23b|WDMM|21|23b. Hall}"), "extreme cold in the Dungeon Master's Guide, area 23b");
t("marcas: summonSpellLevel", convertText("{@damage 1d8 + 3 + summonSpellLevel}"), "1d8 + 3 + the spell's level");
t("marcas: anidadas", convertText("{@b {@i text}}"), "***text***");
t("texto suelto: se escapa el Markdown", convertText("Cure Wounds* and [hover] 1. One"), "Cure Wounds\\* and \\[hover\\] 1. One");
t("texto suelto: «1. » al principio no se vuelve lista", convertText("1. Charm Ray"), "1\\. Charm Ray");

// ---------- Nombres: usos y recargas ----------
t("nombre: recarga como marca", parseEntryName("Fire Breath {@recharge 5}"), { name: "Fire Breath", recharge: 5 });
t("nombre: recarga 6", parseEntryName("Bite {@recharge}"), { name: "Bite", recharge: 6 });
t("nombre: usos y usos en la guarida", parseEntryName("Legendary Resistance (3/Day, or 4/Day in Lair)"), { name: "Legendary Resistance", uses: 3, uses_lair: 4 });
t("nombre: tras un descanso", parseEntryName("Gaze (Recharges after a Short or Long Rest)"), { name: "Gaze", recharge: "short_or_long" });
t("nombre: lo que no se entiende se queda", parseEntryName("Claw (Bear Form Only; Recharges after a Long Rest)"), { name: "Claw (Bear Form Only)", recharge: "long" });
t("nombre: «Costs 2 Actions» se queda", parseEntryName("Drain (Costs 2 Actions)"), { name: "Drain (Costs 2 Actions)" });
t("nombre: «Restoration» no es un descanso", parseEntryName("Eldritch Restoration"), { name: "Eldritch Restoration" });

// ---------- Cabecera ----------
t(
	"alineamientos",
	[["L", "E"], ["N"], ["U"], ["A"], ["L", "NX", "C", "NY", "E"], ["NX", "C", "G", "NY", "E"], ["C", "G", "NY", "E"], ["L", "NX", "C", "E"]].map(alignmentPhrase),
	["Lawful Evil", "Neutral", "Unaligned", "Any Alignment", "Any Non-Good Alignment", "Any Non-Lawful Alignment", "Any Chaotic Alignment", "Any Evil Alignment"],
);
t("alineamiento con probabilidades", alignmentPhrase([{ alignment: ["C", "G"], chance: 75 }, { alignment: ["N", "E"], chance: 25 }]), "Chaotic Good (75%) or Neutral Evil (25%)");
{
	const d = conv({ size: ["L"], type: { type: "beast", swarmSize: "T" }, alignment: ["U"] }).data;
	t("enjambre: tamaño, tipo y tamaño de cada criatura", [d.size, d.type, d.swarm_creature_size, d.alignment], [["large"], ["beast"], ["tiny"], "Unaligned"]);
	const e = conv({ size: ["S", "M"], type: { type: { choose: ["celestial", "fiend"] }, tags: ["titan", { tag: "elf", prefix: "Drow" }] } }).data;
	t("varios tamaños, tipos a elegir y subtipos", [e.size, e.type, e.subtype], [["small", "medium"], ["celestial", "fiend"], ["Titan", "Elf"]]);
}
t("2024 o 2014 por el libro", [conv({}).data.statblock, convertMonster({ name: "X", source: "MM" }, ctx()).data.statblock], ["dnd5e-2024", "dnd5e-2014"]);
t("etiquetas de los libros", ["MM", "XMM", "XPHB", "XDMG", "VGM"].map(bookLabel), ["MM'14", "MM'24", "PHB'24", "DMG'24", "VGM"]);

// ---------- Defensa ----------
{
	const d = conv({ ac: [12, { ac: 15, condition: "with {@spell mage armor}", braces: true }], hp: { average: 22, formula: "4d8 + 4" } }).data;
	t("CA con alternativa a la nota; PG medios que coinciden, fuera", [d.ac, d.ac_note, d.hp, d.hp_formula], [12, "15 with mage armor", undefined, "4d8 + 4"]);
	const e = conv({ ac: [{ ac: 14, from: ["natural armor"] }], hp: { average: 26, formula: "4d8 + 4" } }).data;
	t("CA con armadura; PG medios que no coinciden, se guardan", [e.ac, e.ac_note, e.hp], [14, "natural armor", 26]);
	t("PG especiales y CA especial", [conv({ hp: { special: "40 + 10 per level" }, ac: [{ special: "11 + the spell's level" }] }).data.hp, conv({ ac: [{ special: "11 + PB" }] }).data.ac], ["40 + 10 per level", "11 + PB"]);
}
{
	const d = conv({ speed: { walk: 30, fly: { number: 60, condition: "(hover)" }, canHover: true } }).data;
	t("velocidad: flotar a su casilla", [d.speed, d.hover], [{ walk: 30, fly: 60 }, true]);
	const e = conv({ speed: { walk: 30, alternate: { walk: [{ number: 40, condition: "(bear form only)" }] } } }).data;
	t("velocidad alternativa, como texto", e.speed, { walk: "30 ft., or 40 ft. (bear form only)" });
}
{
	t("VD con guarida (2024): lair, sin PX a mano", (({ cr, lair, xp_lair }) => ({ cr, lair, xp_lair }))(conv({ cr: { cr: "10", xpLair: 7200 } }).data), { cr: "10", lair: true });
	const d = convertMonster({ name: "X", source: "MM", cr: { cr: "18", lair: "20" } }, ctx()).data;
	t("VD en la guarida (2014): sus PX, a mano", [d.cr, d.lair, d.xp_lair], ["18", true, 25000]);
	t("VD 0 con 0 PX: los PX, a mano", conv({ cr: { cr: "0", xp: 0 } }).data.xp, 0);
	t("sin VD: el BC de la nota", conv({ pbNote: "equals your Proficiency Bonus" }).data.pb, "equals your Proficiency Bonus");
	t("iniciativa: pericia", conv({ initiative: { proficiency: 2 } }).data.initiative_proficiency, "expertise");
}

// ---------- Características, competencias y defensas ----------
{
	// VD 5 → BC +3. Des 14 (+2), Sab 12 (+1).
	const d = conv({ cr: "5", dex: 14, wis: 12, save: { dex: "+5", wis: "+9" }, skill: { stealth: "+8", perception: "+4", "sleight of hand": "+2 (+4 at night)" }, passive: 14 }).data;
	t("salvaciones: competencia si coincide; si no, a mano", [d.save_proficiencies, d.saves], [["dex"], { wis: 9 }]);
	t("habilidades: pericia, competencia y texto", [d.skill_proficiencies, d.skills], [{ stealth: "expertise", perception: "proficient" }, { sleight_of_hand: "+2 (+4 at night)" }]);
	t("pasiva que coincide, fuera", d.passive_perception, undefined);
	t("pasiva que no coincide, a mano", conv({ cr: "1", wis: 10, passive: 13 }).data.passive_perception, 13);
}
{
	const d = conv({
		resist: ["cold", { resist: ["bludgeoning", "piercing", "slashing"], note: "from nonmagical attacks", cond: true }],
		immune: ["poison"],
		conditionImmune: ["poisoned", { conditionImmune: ["charmed"], note: "while raging" }],
		senses: ["darkvision 60 ft.", "blindsight 10 ft. (blind beyond this radius)", "Truesight 120 ft. (unimpeded by magical {@variantrule Darkness|XPHB})"],
		languages: ["Common", "Elvish", "and Sylvan but can't speak them", "Infernal; telepathy 60 ft."],
		gear: ["longbow|xphb", { item: "javelin|xphb", quantity: 6 }],
	}).data;
	t("defensas: ids y texto con nota", [d.resistances, d.immunities, d.condition_immunities], [
		["cold", "bludgeoning, piercing, and slashing from nonmagical attacks"],
		["poison"],
		["poisoned", "charmed while raging"],
	]);
	t("sentidos: distancia, o texto con su nota", d.senses, { darkvision: 60, blindsight: "10 ft. (blind beyond this radius)", truesight: "120 ft. (unimpeded by magical Darkness)" });
	t("idiomas: frases partidas unidas y telepatía aparte", d.languages, ["Common", "Elvish, and Sylvan but can't speak them", "Infernal", "telepathy 60 ft."]);
	t("equipo: sin el libro, con cantidad", d.gear, ["Longbow", "Javelin (6)"]);
	const g = conv({ gear: ["bastón|xphb", "smith's tools|xphb", { item: "óleo sagrado", quantity: 2 }, "half-plate armor"] }).data;
	t("equipo: mayúsculas con tildes y apóstrofos", g.gear, ["Bastón", "Smith's Tools", "Óleo Sagrado (2)", "Half-Plate Armor"]);
	const small = conv({ gear: ["potion of healing|xphb", "cota de malla", "a bag of holding", "herramientas de ladrón"] }).data;
	t("equipo: artículos y preposiciones en minúscula, salvo al principio", small.gear, ["Potion of Healing", "Cota de Malla", "A Bag of Holding", "Herramientas de Ladrón"]);
	const kraken = conv({ languages: ["understands Abyssal", "Celestial", "Infernal", "and Primordial but can't speak; telepathy 120 ft."] }).data;
	t("idiomas: la telepatía tras «;» va aparte aunque la frase se una a la anterior", kraken.languages, ["understands Abyssal", "Celestial", "Infernal, and Primordial but can't speak", "telepathy 120 ft."]);
}

// ---------- Rasgos, acciones y entradas anidadas ----------
{
	const d = conv({
		trait: [{ name: "Keen Smell (1/Day)", entries: ["One.", { type: "list", style: "list-hang-notitle", items: [{ type: "item", name: "First", entries: ["A."] }, "Plain."] }] }],
		action: [{ name: "Bite {@recharge 5}", entries: ["{@atkr m} {@hit 4}"] }],
	}).data as Record<string, { name: string; text: string; uses?: number; recharge?: number }[]>;
	t("rasgo: usos del nombre y lista anidada en Markdown", d.traits[0], { name: "Keen Smell", uses: 1, text: "One.\n\n- ***First.*** A.\n- Plain." });
	t("acción: recarga y marcas", d.actions[0], { name: "Bite", recharge: 5, text: "*Melee Attack Roll:* +4" });
}

// ---------- Conjuros ----------
{
	const main = { name: "Spellcasting", type: "spellcasting", headerEntries: ["Main."], ability: "int", displayAs: "action", will: ["{@spell Light|XPHB}"], daily: { "2e": ["{@spell Fly|XPHB}"], "1e": ["{@spell Fear|XPHB}"] } };
	const d = conv({
		spellcasting: [
			main,
			{ name: "Misty Step (3/Day)", headerEntries: ["Teleports."], displayAs: "bonus", hidden: ["daily"], daily: { "3": ["{@spell Misty Step|XPHB}"] } },
			{ name: "Shield (1/Day)", headerEntries: ["Shield."], displayAs: "reaction", hidden: ["daily"], daily: { "1": ["{@spell Shield|XPHB}"] } },
			{ name: "Detect", headerEntries: ["x"], displayAs: "action", hidden: ["will"], will: ["{@spell Detect Magic|XPHB}"] },
			{ name: "Protective Magic (3/Day)", headerEntries: ["Casts one of them."], displayAs: "reaction", hidden: ["daily"], daily: { "3": ["{@spell Counterspell|XPHB}", "{@spell Shield|XPHB}"] } },
			{ name: "Frightful Gaze", headerEntries: ["Casts Fear."], displayAs: "legendary", hidden: ["legendary"], legendary: { "1": ["{@spell Fear|XPHB}"] } },
			{ name: "Fire Wall {@recharge 5}", headerEntries: ["Wall."], displayAs: "action", hidden: ["recharge"], recharge: { "5": ["{@spell Wall of Fire|XPHB}"] } },
		],
	}).data as Record<string, unknown>;
	const blocks = d.spellcasting as { name: string; at_will?: string[]; per_day?: { uses: number; each?: boolean; spells: string[] }[]; text?: string }[];
	t("conjuros: bloque principal y bloque de usos compartidos (los usos, fuera del nombre)", blocks.map((b) => b.name), ["Spellcasting", "Protective Magic"]);
	t("conjuros sueltos: a voluntad y al día, juntados con el principal (nueva línea o la de sus mismos usos)", [blocks[0].at_will, blocks[0].per_day], [
		["{@spell Light}", "{@spell Detect Magic}"],
		[
			{ uses: 3, each: true, spells: ["{@spell Misty Step}"] },
			{ uses: 2, each: true, spells: ["{@spell Fly}"] },
			{ uses: 1, each: true, spells: ["{@spell Fear}", "{@spell Shield}"] },
		],
	]);
	t("usos compartidos: su texto y sus usos en el bloque, sin repetir los conjuros; sin CD si es la misma característica", blocks[1], { name: "Protective Magic", uses: 3, text: "Casts one of them." });
	const other = conv({ spellcasting: [main, { name: "Divine Aid (2/Day)", headerEntries: ["x"], ability: "wis", displayAs: "bonus", hidden: ["daily"], daily: { "2": ["{@spell Bless|XPHB}", "{@spell Aid|XPHB}"] } }] }).data.spellcasting as { hide_dc?: boolean }[];
	t("usos compartidos con otra característica: con su CD", other[1].hide_dc, undefined);
	t("usos compartidos con la misma característica (int): sin CD", conv({ spellcasting: [main, { name: "Magic (1/Day)", headerEntries: ["x"], ability: "int", displayAs: "reaction", hidden: ["daily"], daily: { "1": ["{@spell Shield|XPHB}", "{@spell Fly|XPHB}"] } }] }).data.spellcasting, [
		(conv({ spellcasting: [main] }).data.spellcasting as unknown[])[0],
		{ name: "Magic", uses: 1, ability: "int", hide_dc: true, text: "x" },
	]);
	t("conjuro legendario y con recarga: entradas de su sección", [(d.legendary_actions as { name: string }[]).map((e) => e.name), (d.actions as { name: string; recharge?: number }[]).map((e) => [e.name, e.recharge])], [["Frightful Gaze"], [["Fire Wall", 5]]]);
	const lone = conv({ spellcasting: [{ name: "Invisibility", headerEntries: ["Turns invisible."], displayAs: "action", hidden: ["will"], will: ["{@spell Invisibility|XPHB}"] }] }).data;
	t("sin bloque principal: el conjuro suelto, una entrada", [lone.spellcasting, (lone.actions as { name: string; text: string }[])[0]], [undefined, { name: "Invisibility", text: "Turns invisible." }]);
	const old = convertMonster(
		{ name: "Mephit", source: "MM", spellcasting: [{ name: "Innate Spellcasting (1/Day)", headerEntries: ["Can cast {@spell sleep}."], hidden: ["will"], will: ["{@spell sleep}"] }] },
		ctx(),
	).data as Record<string, { name: string; at_will?: string[] }[]>;
	t("2014: hidden solo oculta la lista (ya escrita en el texto); el bloque se queda", [old.spellcasting[0].name, old.spellcasting[0].at_will], ["Innate Spellcasting", undefined]);
	const slots = convertMonster({ name: "Priestess", source: "MM", spellcasting: [{ name: "Spellcasting", headerEntries: ["x"], ability: "wis", spells: { "0": { spells: ["{@spell light}"] }, "1": { slots: 4, spells: ["{@spell bless}"] } } }] }, ctx()).data
		.spellcasting as { levels: unknown }[];
	t("2014: niveles con espacios", slots[0].levels, [{ level: 0, spells: ["{@spell light}"] }, { level: 1, slots: 4, spells: ["{@spell bless}"] }]);
}

// ---------- Grupos legendarios, variantes y cuerpo ----------
{
	const groups = [
		{ name: "Hag", source: "VGM", lairActions: ["Intro.", { type: "list", items: ["Base lair."] }], regionalEffects: ["Base region."] },
		{ name: "Sea Witch", source: "MM", _copy: { name: "Hag", source: "VGM", _mod: { lairActions: { mode: "appendArr", items: ["Extra."] } } } },
	];
	const c = convertMonster({ name: "Sea Witch", source: "MM", legendaryGroup: { name: "Sea Witch", source: "MM" }, variant: [{ type: "variant", name: "Variant: Pet", entries: ["A pet."] }] }, ctx(groups));
	t("grupo copiado (appendArr): introducción y acciones de guarida", [c.data.lair_actions_header, c.data.lair_actions], ["Intro.", [{ name: "", text: "Base lair." }, { name: "", text: "Extra." }]]);
	t("variantes y efectos regionales, al cuerpo", c.body, "## Variant: Pet\n\nA pet.\n\n## Regional Effects\n\nBase region.");
	t("grupo que no está cargado", [missingGroup({ legendaryGroup: { name: "Other", source: "MM" } }, legendaryGroupIndex(groups)), missingGroup({ legendaryGroup: { name: "Hag", source: "VGM" } }, legendaryGroupIndex(groups))], [true, false]);
}
{
	const d = conv({ environment: ["underdark", "planar, abyss"], treasure: ["relics"], page: 12, legendaryActionsLair: 4 }).data;
	t("otros datos y usos legendarios en la guarida", [d.habitat, d.treasure, d.source, d.page, d.legendary_uses_lair], [["underdark", "planar, abyss"], ["relics"], "XMM", 12, 4]);
}
