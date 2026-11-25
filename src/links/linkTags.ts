/**
 * Enlaces de las notas y los statblocks (1.4, paso 6; §12): `{@condition Grappled}`, `{@creature Goblin}` y
 * `{@spell Fireball}`, con sus nombres en español `{@condicion …}`, `{@criatura …}` y `{@hechizo …}`. La
 * forma completa es `{@tipo nombre|fuente|texto}`: se muestra `texto` si lo hay; si no, `nombre`. La fuente
 * (el libro, en los datos de 5etools) se ignora. Sin DOM (se prueba en los tests).
 */

export type LinkKind = "condition" | "creature" | "spell";

export interface LinkTag {
	kind: LinkKind;
	/** El nombre que se busca (la condición, la criatura o el conjuro). */
	name: string;
	/** Lo que se muestra. */
	display: string;
	/** La marca tal cual, para la vista de edición. */
	raw: string;
}

const KINDS: Record<string, LinkKind> = {
	condition: "condition",
	condicion: "condition",
	"condición": "condition",
	creature: "creature",
	criatura: "creature",
	spell: "spell",
	hechizo: "spell",
	conjuro: "spell",
};

/** Una marca de enlace (con `g`: para recorrer un texto). */
export const LINK_TAG_RE = /\{@(condition|condici[oó]n|creature|criatura|spell|hechizo|conjuro)\s+([^{}]+?)\}/gi;

export function parseLinkTag(raw: string, kindWord: string, body: string): LinkTag {
	const parts = body.split("|");
	const name = parts[0].trim();
	return { kind: KINDS[kindWord.toLowerCase()] ?? "condition", name, display: (parts[2] ?? "").trim() || name, raw };
}

/** Parte un texto en trozos de texto y marcas de enlace. */
export function splitLinkTags(text: string): (string | LinkTag)[] {
	const out: (string | LinkTag)[] = [];
	let last = 0;
	for (const m of text.matchAll(LINK_TAG_RE)) {
		const i = m.index ?? 0;
		if (i > last) out.push(text.slice(last, i));
		out.push(parseLinkTag(m[0], m[1], m[2]));
		last = i + m[0].length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

/** Forma para comparar nombres: sin mayúsculas, acentos ni espacios de más («Agarrado» = «agarrado»). */
export function normalizeName(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Rangos de código de un texto Markdown (bloques con ``` o ~~~, código en línea con `…`, y las propiedades
 * del principio): ahí las marcas no son enlaces. Para Live Preview, que no tiene el árbol de sintaxis a mano.
 */
export function codeRanges(text: string): [number, number][] {
	const ranges: [number, number][] = [];
	let pos = 0;
	const lines = text.split("\n");
	let fence: string | null = null;
	let fenceStart = 0;
	// Propiedades: de la primera línea «---» a la siguiente «---».
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) {
			const len = lines.slice(0, end + 1).join("\n").length;
			ranges.push([0, len]);
		}
	}
	for (const line of lines) {
		const m = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
				ranges.push([fenceStart, pos + line.length]);
				fence = null;
			}
		} else if (m) {
			fence = m[1];
			fenceStart = pos;
		} else
			for (const c of line.matchAll(/(`+)[^`]*?\1/g)) {
				const i = pos + (c.index ?? 0);
				ranges.push([i, i + c[0].length]);
			}
		pos += line.length + 1;
	}
	if (fence) ranges.push([fenceStart, text.length]);
	return ranges;
}
