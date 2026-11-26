// Marca del nombre en los textos ({@name}/{@Name}; 2026-11-26): detectarla al importar y dibujarla. Criaturas y textos inventados.
import { convertMonster, legendaryGroupIndex } from "../src/statblock/import5e";
import { fillNameTags, findNameRef, insertNameTags } from "../src/statblock/nameTags";
import { readStatblock } from "../src/statblock/data";
import { creatureRef, statblockLayout } from "../src/statblock/layout";
import { BUILTIN_PRESET } from "../src/statblock/presets";
import { setTranslateContent } from "../src/i18n";
import { setLocale, t } from "./helpers";

// ---------- Detectar al importar ----------
{
	const texts = ["The dragon bites. If the dragon fails a save, it succeeds.", "The dragon's breath fills a cone.", "Another dragon roars."];
	const found = findNameRef(texts, "Grand Blue Dragon", false);
	t("detectar: la parte del nombre que más usan, con su artículo", found, { ref: "the dragon", part: "dragon", article: "the" });
	t("cambiar: «The» → {@Name}, «the» → {@name}; sin artículo, no («Another dragon»)", texts.map((x) => insertNameTags(x, found!)), [
		"{@Name} bites. If {@name} fails a save, it succeeds.",
		"{@Name}'s breath fills a cone.",
		"Another dragon roars.",
	]);
}
{
	const texts = ["El liche lanza un conjuro.", "Aparece en la guarida del liche.", "Si el liche falla, se lo pasa al liche aliado."];
	const found = findNameRef(texts, "Liche", false);
	t("detectar en español: «del» y «al» cuentan como «el»", found, { ref: "el liche", part: "liche", article: "el" });
	t("cambiar en español: «del liche» → «de {@name}», «al liche» → «a {@name}»", texts.map((x) => insertNameTags(x, found!)), [
		"{@Name} lanza un conjuro.",
		"Aparece en la guarida de {@name}.",
		"Si {@name} falla, se lo pasa a {@name} aliado.",
	]);
}
{
	const texts = ["La saga tiene ventaja. La saga puede crear un saco.", "El saco de la saga se rompe."];
	t("detectar: partes que no empiezan ni acaban en «de»/«la» («Saga de la Noche» → «la saga»)", findNameRef(texts, "Saga de la Noche", false)?.ref, "la saga");
}
t("detectar: palabras separadas por guiones («Will-o'-Wisp» → «the wisp»)", findNameRef(["The wisp glows. The wisp can't wear anything."], "Will-o'-Wisp", false)?.ref, "the wisp");
t("detectar: si empatan, la parte más larga", findNameRef(["The red wyrm hisses. The wyrm hisses."], "Red Wyrm", false)?.ref, "the red wyrm");
t("detectar: nombre propio, sin artículo", findNameRef(["Varka strikes twice. Varka can't be charmed."], "Varka the Bold", true)?.ref, "Varka");
t("detectar: ninguna parte en los textos", findNameRef(["It attacks."], "Shadow", false), null);

// ---------- Importar ----------
{
	const ctx = { groups: legendaryGroupIndex([]), headings: { regionalEffects: "Regional Effects" } };
	const c = convertMonster(
		{
			name: "Moss Troll",
			source: "XMM",
			trait: [{ name: "Regrowth", entries: ["The troll regains 10 Hit Points at the start of its turn."] }],
			action: [{ name: "Multiattack", entries: ["The troll makes two Claw attacks."] }],
			legendaryHeader: ["The troll can take 3 legendary actions."],
			legendary: [{ name: "Move", entries: ["The troll moves."] }],
		},
		ctx,
	);
	t("importar: «Nombre en el texto» con artículo y marcas en entradas e introducción legendaria", [c.data.short_name, (c.data.traits as { text: string }[])[0].text, c.data.legendary_header], [
		"the troll",
		"{@Name} regains 10 Hit Points at the start of its turn.",
		"{@Name} can take 3 legendary actions.",
	]);
}

// ---------- Dibujar ----------
t("dibujar: {@Name} con mayúscula, {@name} sin ella", fillNameTags("{@Name} bites; {@name} flees.", "the troll"), "The troll bites; the troll flees.");
t("dibujar: «de»/«a» + «el …» se contraen; con «la», no", [fillNameTags("La guarida de {@name}. A {@name} le gusta.", "el liche"), fillNameTags("El saco de {@name}.", "la saga")], [
	"La guarida del liche. Al liche le gusta.",
	"El saco de la saga.",
]);
t("dibujar: «de» dentro de otra palabra no se contrae", fillNameTags("Puede {@name}.", "el liche"), "Puede el liche.");

setLocale("es");
setTranslateContent(true);
{
	const catalog = { customConditions: [], conditionOverrides: {} };
	const fm = { statblock: "dnd5e-2024", name: "Moss Troll", short_name: "the troll", traits: [{ name: "Regrowth", text: "{@Name} regains 10 Hit Points." }] };
	const sb = readStatblock(fm, "Moss Troll");
	t("con el contenido en español, «the troll» se deja tal cual (artículo de otro idioma)", creatureRef(sb), "the troll");
	const l = statblockLayout(sb, { preset: BUILTIN_PRESET, catalog });
	t("la maqueta cambia las marcas de las entradas", l.sections[0].entries[0].markdown.includes("The troll regains 10 Hit Points."), true);
	t("sin «Nombre en el texto»: el nombre con el artículo del idioma del contenido", creatureRef(readStatblock({ statblock: "dnd5e-2024", name: "Goblin" }, "Goblin")), "el goblin");
	t("nombre propio: el «Nombre en el texto» si lo tiene", creatureRef(readStatblock({ statblock: "dnd5e-2024", name: "Varka the Bold", named: true, short_name: "Varka" }, "x")), "Varka");
}
