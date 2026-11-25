// 1.4, paso 6: enlaces {@condition}, {@creature}, {@spell} (y sus nombres en español).
import { findCondition } from "../src/links/linkResolve";
import { codeRanges, normalizeName, splitLinkTags } from "../src/links/linkTags";
import { setLocale, t } from "./helpers";

const catalog = { customConditions: [], conditionOverrides: {} };

t(
	"marcas: tipo, nombre y texto a mostrar; fuente ignorada; nombres en español",
	splitLinkTags("A {@condition Grappled|XPHB} y {@criatura Goblin||goblins}, {@hechizo Bola de fuego} {@condición Agarrado}."),
	[
		"A ",
		{ kind: "condition", name: "Grappled", display: "Grappled", raw: "{@condition Grappled|XPHB}" },
		" y ",
		{ kind: "creature", name: "Goblin", display: "goblins", raw: "{@criatura Goblin||goblins}" },
		", ",
		{ kind: "spell", name: "Bola de fuego", display: "Bola de fuego", raw: "{@hechizo Bola de fuego}" },
		" ",
		{ kind: "condition", name: "Agarrado", display: "Agarrado", raw: "{@condición Agarrado}" },
		".",
	],
);
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
