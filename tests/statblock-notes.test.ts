// 1.4: formulario de statblocks. Limpieza del borrador, orden de las propiedades al guardar, nombres de
// nota libres y el alineamiento escrito en el formulario.
import type StrakesTTRPG from "../src/main";
import { alignmentFromInput } from "../src/statblock/markdown";
import { cleanDraft, cleanValue, draftFromFrontmatter, freeNotePath, writeDraft } from "../src/statblock/notes";
import { setLocale, t } from "./helpers";

t("cleanValue: vacíos fuera (texto, false, listas y objetos vacíos)", [cleanValue(""), cleanValue("  "), cleanValue(false), cleanValue([]), cleanValue({}), cleanValue({ a: "", b: [] })], [undefined, undefined, undefined, undefined, undefined, undefined]);
t("cleanValue: conserva lo que tiene valor, y el 0", [cleanValue(0), cleanValue(true), cleanValue(["a", ""]), cleanValue({ walk: 30, fly: "" })], [0, true, ["a"], { walk: 30 }]);
t(
	"cleanValue: entradas de listas sin nada, fuera; con algo, sin sus campos vacíos",
	cleanValue([{ name: "", text: "" }, { name: "Garra", text: "", uses: 2 }]),
	[{ name: "Garra", uses: 2 }],
);
t(
	"cleanDraft: solo propiedades de statblock, en su orden, sin initiative_proficiency none",
	Object.keys(cleanDraft({ cr: "1", tags: ["x"], name: "Goblin", statblock: "dnd5e-2024", initiative_proficiency: "none", ac: 15 })),
	["statblock", "name", "ac", "cr"],
);
{
	const fm = { statblock: "dnd5e-2024", speed: { walk: 30 }, tags: ["monstruo"] };
	const d = draftFromFrontmatter(fm);
	(d.speed as Record<string, unknown>).fly = 60;
	t("draftFromFrontmatter: copia (no toca las propiedades originales) y sin las ajenas", [fm.speed, Object.keys(d)], [{ walk: 30 }, ["statblock", "speed"]]);
}

// writeDraft con un processFrontMatter falso: reescribe las de statblock en su orden y deja las demás detrás.
{
	const fm: Record<string, unknown> = { tags: ["monstruo"], cr: "1", name: "Viejo", statblock: "dnd5e-2024", hp: 7 };
	const plugin = {
		app: { fileManager: { processFrontMatter: (_f: unknown, fn: (fm: Record<string, unknown>) => void) => Promise.resolve(fn(fm)) } },
	} as unknown as StrakesTTRPG;
	void writeDraft(plugin, {} as never, { statblock: "dnd5e-2024", name: "Goblin", cr: "1/4", ac: 15, hp: "" }).then(() => {
		t("writeDraft: statblock en orden, las ajenas detrás, lo vaciado se borra", [Object.keys(fm), fm.name, fm.hp], [["statblock", "name", "ac", "cr", "tags"], "Goblin", undefined]);
	});
}

// Rutas libres: nunca se sobrescribe una nota.
{
	const existing = new Set(["Statblocks/ST-Goblin.md", "Statblocks/ST-Goblin 2.md"]);
	const plugin = { app: { vault: { getAbstractFileByPath: (p: string) => (existing.has(p) ? {} : null) } } } as unknown as StrakesTTRPG;
	t("freeNotePath: añade un número si existe", [freeNotePath(plugin, "Statblocks", "ST-Goblin"), freeNotePath(plugin, "Statblocks", "ST-Orco"), freeNotePath(plugin, "", "Orco")], [
		"Statblocks/ST-Goblin 3.md",
		"Statblocks/ST-Orco.md",
		"Orco.md",
	]);
	t("freeNotePath: quita los caracteres que no valen en un nombre de nota", freeNotePath(plugin, "", 'Dragón: "rojo"/viejo'), "Dragón rojoviejo.md");
}

// Alineamiento escrito: las frases conocidas (traducidas o en inglés) se guardan en inglés.
setLocale("es");
t(
	"alineamiento: traducido (masculino o femenino) o en inglés → en inglés; desconocido, tal cual",
	[alignmentFromInput("Legal Malvado"), alignmentFromInput("caótica buena"), alignmentFromInput("neutral evil"), alignmentFromInput("Sin Alineamiento"), alignmentFromInput("Lo que diga Strahd"), alignmentFromInput("  ")],
	["Lawful Evil", "Chaotic Good", "Neutral Evil", "Unaligned", "Lo que diga Strahd", ""],
);
