// 1.4, paso 6: enlaces {@condition}, {@creature}, {@spell}.
import { findCondition } from "../src/links/linkResolve";
import { codeRanges, hasLinkTag, normalizeName, splitLinkTags, wrapLinkTag } from "../src/links/linkTags";
import { setLocale, t } from "./helpers";

const catalog = { customConditions: [], conditionOverrides: {} };

t(
	"marcas: nombre|texto|libro (el libro, aparte)",
	splitLinkTags("A {@condition Grappled||XPHB} y {@creature Goblin|goblins}, {@spell Bola de fuego} {@condition Agarrado}."),
	[
		"A ",
		{ kind: "condition", name: "Grappled", display: "Grappled", raw: "{@condition Grappled||XPHB}", source: "XPHB" },
		" y ",
		{ kind: "creature", name: "Goblin", display: "goblins", raw: "{@creature Goblin|goblins}" },
		", ",
		{ kind: "spell", name: "Bola de fuego", display: "Bola de fuego", raw: "{@spell Bola de fuego}" },
		" ",
		{ kind: "condition", name: "Agarrado", display: "Agarrado", raw: "{@condition Agarrado}" },
		".",
	],
);
{
	// Las marcas con el nombre en español se quitaron el 2026-11-25: ya no son enlaces.
	const text = "{@condicion Agarrado} {@condición Agarrado} {@criatura Goblin} {@hechizo Bola de fuego} {@conjuro Escudo}";
	t("marcas: las de nombre en español no son enlaces", [hasLinkTag(text), splitLinkTags(text)], [false, [text]]);
}
{
	// Regresión (Liche, 2026-11-25): comprobar el texto antes de partirlo hacía saltar la primera marca.
	const text = "The lich casts {@spell Counterspell} or {@spell Shield} in response.";
	const names = () => splitLinkTags(text).flatMap((p) => (typeof p === "string" ? [] : [p.name]));
	t("marcas: comprobar antes de partir no se salta la primera", [hasLinkTag(text), hasLinkTag(text), names(), names()], [true, true, ["Counterspell", "Shield"], ["Counterspell", "Shield"]]);
}
t("marcas: otras marcas no son enlaces", splitLinkTags("{@dice 1d6} {@item sword}"), ["{@dice 1d6} {@item sword}"]);
t("nombres: sin mayúsculas ni acentos", normalizeName("  Visión  EN la Oscuridad "), "vision en la oscuridad");

setLocale("es");
t("condición: por id, por nombre en inglés o en español, sin acentos", ["grappled", "Grappled", "apresado", "APRESADO", "Hechizado"].map((n) => findCondition(n, catalog)?.id), ["grappled", "grappled", "grappled", "grappled", "charmed"]);
t("condición: también por el nombre cambiado por el usuario y las personalizadas", [
	findCondition("Atrapado", { customConditions: [], conditionOverrides: { grappled: { name: "Atrapado" } } })?.id,
	findCondition("Marcado", { customConditions: [{ id: "c1", name: "Marcado", icon: "x", description: "", implies: [] }], conditionOverrides: {} })?.id,
], ["grappled", "c1"]);
t("condición: desconocida", findCondition("Bailando", catalog), null);

t(
	"código: bloques, en línea y propiedades (ahí las marcas no son enlaces)",
	codeRanges("---\nname: x\n---\nTexto `{@condition A}` y\n```\n{@condition B}\n```\nfin"),
	[[0, 15], [22, 38], [41, 63]],
);

t("enlazar como: envuelve lo seleccionado, con los espacios de los bordes fuera", [wrapLinkTag(" Bola de fuego ", "spell"), wrapLinkTag("Goblin", "creature")], [" {@spell Bola de fuego} ", "{@creature Goblin}"]);
