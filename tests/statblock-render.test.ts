// 1.4: statblocks. Lectura de las propiedades, cálculos y Markdown del callout [!statblocks] de ITS.
import { abilityMod, averageHp, derive, lairXpForCr, pbForCr, xpForCr } from "../src/statblock/compute";
import { nameFromNote, readStatblock } from "../src/statblock/data";
import { alignmentName, creatureRef, headerLine, speedLine, statblockMarkdown } from "../src/statblock/markdown";
import { setLocale, t } from "./helpers";

const catalog = { customConditions: [], conditionOverrides: {} };
const opts = { metric: false, catalog };
const sb = (fm: Record<string, unknown>, name = "Criatura") => readStatblock({ statblock: "dnd5e-2024", ...fm }, name);
const md = (fm: Record<string, unknown>, metric = false) => statblockMarkdown(sb(fm), { ...opts, metric });
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
	const text = md(aboleth);
	const lines = text.split("\n");
	t("es: todas las líneas dentro del callout", lines.every((l) => l.startsWith(">")), true);
	t("es: empieza por [!statblocks] y el nombre en #", lines.slice(0, 2), ["> [!statblocks]", "> # Aboleth"]);
	t("es: línea de tipo en una cita", has(text, "> > Aberración Grande, Legal Malvada"), true);
	t("es: CA, iniciativa con puntuación y VD", has(text, "| **CA** | 17 | **Iniciativa** | +3 (13) | **VD** | 10 |"), true);
	t("es: PG con fórmula y BC", has(text, "| **PG** | 150 (20d10 + 40) |  |  | **BC** | +4 |"), true);
	t("es: velocidad en una línea aparte bajo la tabla, antes de la raya", has(text, "| **PG** | 150 (20d10 + 40) |  |  | **BC** | +4 |\n>\n> **Velocidad**: 10 pies, Nadar 40 pies\n>\n> ---"), true);
	t("es: la tabla ya no tiene fila de velocidad", has(text, "| **Velocidad**"), false);
	t("es: tabla de características", has(text, "| FUE | DES | CON | INT | SAB | CAR |  |"), true);
	t("es: modificadores con el signo menos tipográfico", has(text, "| +5 | −1 | +2 | +4 | +2 | +4 | **Mod** |"), true);
	t("es: salvaciones", has(text, "| +5 | +3 | +6 | +8 | +6 | +4 | **Salv.** |"), true);
	t("es: habilidades en orden alfabético", has(text, "**Habilidades**: Historia +12, Percepción +10"), true);
	t("es: sentidos con la Percepción pasiva", has(text, "**Sentidos**: Visión en la oscuridad 120 pies; Percepción pasiva 20"), true);
	t("es: idiomas", has(text, "**Idiomas**: Deep Speech, telepathy 120 ft."), true);
	t("es: PX con la guarida", has(text, "**PX**: 5900, o 7200 en su guarida"), true);
	t("es: sin líneas vacías de vulnerabilidades, resistencias, inmunidades ni equipo", ["Vulnerabilidades", "Resistencias", "Inmunidades", "Equipo"].some((w) => has(text, w)), false);
	t("es: usos en la guarida", has(text, "**Legendary Resistance (3/día, o 4/día en su guarida)**: If the aboleth"), true);
	t("es: recarga", has(text, "**Consume Memories (Recarga 5–6)**: Wisdom Saving Throw."), true);
	t("es: encabezados de sección", ["#### Rasgos", "#### Acciones", "#### Acciones Legendarias"].every((h) => has(text, h)), true);
	t(
		"es: introducción generada de las acciones legendarias",
		has(text, "Usos de acción legendaria: 3 (4 en su guarida). Inmediatamente después del turno de otra criatura, el aboleth puede gastar un uso para realizar una de las siguientes acciones. El aboleth recupera todos"),
		true,
	);
	t("es: sin secciones vacías", ["Reacciones", "Míticas", "Adicionales", "Lanzamiento"].some((w) => has(text, w)), false);
	t("es: líneas seguidas con salto forzado (dos espacios)", has(text, "> **Habilidades**: Historia +12, Percepción +10  \n> **Sentidos**"), true);
}
t("es: sin idiomas, «Idiomas —»", has(md({ str: 10 }), "**Idiomas**: —"), true);
t("es: sin nada, solo el nombre y los idiomas", md({}, false).split("\n"), ["> [!statblocks]", "> # Criatura", ">", "> **Idiomas**: —"]);
t("es: sentidos en metros", has(md({ senses: { blindsight: 60 }, wis: 10 }, true), "Vista ciega 60 pies (18 m); Percepción pasiva 10"), true);
t("es: CA con nota conocida, traducida", has(md({ ac: 13, ac_note: "chain shirt" }), "| **CA** | 13 (camisote de mallas) |"), true);
t("es: nota de CA con varias partes, sin distinguir mayúsculas", has(md({ ac: 20, ac_note: "Plate Armor, shield" }), "| **CA** | 20 (armadura de placas, escudo) |"), true);
t("es: nota de CA desconocida, tal cual", has(md({ ac: 15, ac_note: "15 with Mage Armor" }), "| **CA** | 15 (15 with Mage Armor) |"), true);
t("es: sentidos de texto conocidos, traducidos", has(md({ senses: { blindsight: 30 }, senses_other: ["echolocation", "smells fear"] }), "**Sentidos**: Vista ciega 30 pies, ecolocalización, smells fear"), true);
t("es: solo velocidad, sin tabla: línea y raya antes de las características", has(md({ speed: { walk: 30 }, str: 10 }), "> **Velocidad**: 30 pies\n>\n> ---\n>\n> | FUE"), true);
t(
	"es: inmunidades de daño y condiciones juntas, con «;»",
	has(md({ immunities: ["fire", "poison"], condition_immunities: ["charmed", "Mi condición"] }), "**Inmunidades**: Fuego, Veneno; Hechizado, Mi condición"),
	true,
);
t("es: resistencias en texto (2014), tal cual", has(md({ resistances: ["cold", "bludgeoning from nonmagical attacks"] }), "**Resistencias**: Frío, bludgeoning from nonmagical attacks"), true);
t("es: el paréntesis propio del nombre se junta con «;»", has(md({ actions: [{ name: "Fell Glare (Fiend Only)", text: "x", recharge: "long" }] }), "**Fell Glare (Fiend Only; Se recarga tras un descanso largo)**: x"), true);
t("es: marcas de 5etools que queden, como texto", has(md({ actions: [{ name: "Garra", text: "El objetivo queda {@condition Grappled|XPHB}." }] }), "El objetivo queda Grappled."), true);
t("es: Nombre propio, sin artículo", creatureRef(sb({ name: "Strahd", named: true })), "Strahd");
t("es: nombre en el texto con su artículo", [creatureRef(sb({ name: "Arpía", short_name: "la arpía" })), creatureRef(sb({ name: "Goblin Jefe", short_name: "goblin" }))], ["la arpía", "el goblin"]);
t("es: encabezado legendario escrito, en lugar del generado", has(md({ legendary_header: "Cabecera propia.", legendary_actions: [{ name: "A", text: "b" }] }), "> Cabecera propia."), true);
{
	const text = md({
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
			{ name: "Counterspell (2/Day)", use: "reaction", ability: "cha", text: "x", per_day: { uses: 2, spells: ["Counterspell"] } },
		],
	});
	t("es: sección de conjuros entre Rasgos y Acciones", has(text, "#### Lanzamiento de Conjuros"), true);
	t("es: CD y ataque en una línea nueva tras el texto", has(text, "**Spellcasting**: The creature casts one of the following spells.  \n> CD de salvación de conjuros 14, +6 al ataque con conjuros"), true);
	t("es: a voluntad, al día cada uno y por niveles (trucos primero)", ["**A voluntad:** *Mage Hand*, *Prestidigitation*", "**1/día cada uno:** *Fireball*, *Fly*", "**Trucos:** *Light*", "**Nivel 1 (4 espacios):** *Shield*"].every((p) => has(text, p)), true);
	t("es: tipo de uso en el paréntesis del nombre", has(text, "**Counterspell (2/Day; reacción)**: x"), true);
	t("es: texto final", has(text, "> Pie."), true);
}
{
	const text = md({ all_skills: true, str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10, cr: "1", skill_proficiencies: { stealth: "proficient" } });
	t("es: mostrar todas las habilidades: tabla de cuatro columnas", has(text, "| Habilidad | Mod | Habilidad | Mod |"), true);
	t("es: con todas, no hay línea de Habilidades", has(text, "**Habilidades**"), false);
	t("es: tabla de habilidades en orden alfabético, de arriba abajo", has(text, "| Acrobacias | +2 | Medicina | +1 |"), true);
	t("es: con competencia, el BC", has(text, "| Sigilo | +4 |"), true);
}
setLocale("en");
{
	const text = md(aboleth);
	t("en: XP with lair, number format", has(text, "**XP**: 5,900, or 7,200 in Lair"), true);
	t("en: generated legendary intro", has(text, "Legendary Action Uses: 3 (4 in Lair). Immediately after another creature's turn, the aboleth can expend a use"), true);
	t("en: uses", has(text, "**Legendary Resistance (3/Day, or 4/Day in Lair)**"), true);
}
setLocale("es");
