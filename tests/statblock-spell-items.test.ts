// Conjuros de las listas de Lanzamiento de conjuros (2026-11-26): marca al escribirlos, nota fuera, y en el statblock solo el nombre en cursiva.
import { readStatblock } from "../src/statblock/data";
import { splitSpellItem, spellItemFromInput, spellItemLabel, statblockLayout } from "../src/statblock/layout";
import { BUILTIN_PRESET } from "../src/statblock/presets";
import { t } from "./helpers";

// ---------- Escribir en el formulario ----------
t("escribir: el nombre, con su marca", spellItemFromInput("  Armadura de Mago "), "{@spell Armadura de Mago}");
t("escribir: el paréntesis queda fuera, con su espacio", spellItemFromInput("Invisibilidad (solo sobre sí mismo)"), "{@spell Invisibilidad} (solo sobre sí mismo)");
t("escribir: el asterisco, pegado", spellItemFromInput("Armadura de Mago*"), "{@spell Armadura de Mago}*");
t("escribir: asterisco y paréntesis", spellItemFromInput("Armadura de Mago* (incluida en la CA)"), "{@spell Armadura de Mago}* (incluida en la CA)");
t("escribir: con una marca, tal cual", spellItemFromInput("{@spell Armadura de Mago} El Mago lo lanza antes del combate"), "{@spell Armadura de Mago} El Mago lo lanza antes del combate");
t("escribir: sin nombre delante, tal cual", spellItemFromInput("(nota)"), "(nota)");

// ---------- Leer ----------
t("leer: marca y nota con su espacio", splitSpellItem("{@spell Invisibility} (self only)"), { name: "Invisibility", note: " (self only)" });
t("leer: asterisco", splitSpellItem("{@spell mage armor}*"), { name: "mage armor", note: "*" });
t("leer: la nota conserva las marcas de enlace y quita las demás", splitSpellItem("{@spell Mage Hand} (the hand is {@condition Invisible}, {@b bold})").note, " (the hand is {@condition Invisible}, bold)");
t("leer: sin marca (escritos antes), el nombre hasta el primer «(»", splitSpellItem("Fireball (level 4 version)"), { name: "Fireball", note: " (level 4 version)" });
t("leer: sin marca ni nota", splitSpellItem("Fireball"), { name: "Fireball", note: "" });
t("etiqueta del formulario: sin marcas", spellItemLabel("{@spell Mage Hand} (the hand is {@condition Invisible|invisible})"), "Mage Hand (the hand is invisible)");

// ---------- Dibujar ----------
{
	const catalog = { customConditions: [], conditionOverrides: {} };
	const sb = readStatblock(
		{
			statblock: "dnd5e-2024",
			name: "Test",
			spellcasting: [
				{
					at_will: ["{@spell Mage Hand} (the hand is invisible)", "Light"],
					per_day: [{ uses: 1, each: true, spells: ["{@spell Invisibility} (self only)"] }],
				},
			],
		},
		"Test",
	);
	const l = statblockLayout(sb, { preset: BUILTIN_PRESET, catalog });
	const lines = l.sections[0].entries[0].spell?.lines ?? [];
	t("dibujar: nombre y nota aparte (la nota no va en cursiva)", lines[0].spells, [{ name: "Mage Hand", note: " (the hand is invisible)" }, { name: "Light" }]);
	t("dibujar: en «cada uno», las casillas van por el nombre, sin la nota", lines[1].spells[0].boxes?.ref, { kind: "perDay", block: 0, index: 0, spell: "Invisibility" });
}
