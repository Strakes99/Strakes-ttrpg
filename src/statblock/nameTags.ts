/**
 * Marca del nombre de la criatura en los textos del statblock (pedido del desarrollador, 2026-11-26, opción a):
 * `{@name}` se dibuja con el «Nombre en el texto» (`short_name`, o el calculado: «el aboleth») y `{@Name}`,
 * igual pero con mayúscula, para el principio de una frase. Así, cambiar ese nombre cambia todos los textos.
 *
 * - Al dibujar (`fillNameTags`): en español, «de {@name}» y «a {@name}» con un nombre que empieza por «el»
 *   se contraen («del liche», «al liche»).
 * - Al importar (`findNameRef` + `insertNameTags`): los textos de los bestiarios escriben la criatura con
 *   artículo («the dragon», «el liche», «la saga»), no siempre con el nombre completo («Adult Red Dragon»
 *   → «the dragon»). Se busca qué parte del nombre usan, se guarda como `short_name` con su artículo y se
 *   cambia por la marca.
 *
 * Sin dependencias de Obsidian ni de \`i18n\`: lo usa el importador, que se prueba (y empaqueta la herramienta
 * de traducción de los bestiarios) fuera de Obsidian.
 */

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

/**
 * Cambia las marcas `{@name}`/`{@Name}` de un texto por cómo se llama a la criatura (`ref`). `capitalize`:
 * cómo poner la mayúscula (la maqueta usa las reglas del idioma del contenido).
 */
export function fillNameTags(text: string, ref: string, capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)): string {
	if (!text.includes("{@")) return text;
	const masculine = /^el\s+/i.exec(ref);
	return text.replace(new RegExp(`${NOT_LETTER_BEFORE}([Dd]e|[Aa]) \\{@name\\}|\\{@([nN])ame\\}`, "gu"), (_all, prep: string | undefined, n: string | undefined) => {
		if (prep) return masculine ? `${prep}l ${ref.slice(masculine[0].length)}` : `${prep} ${ref}`;
		return n === "N" ? capitalize(ref) : ref;
	});
}

/** Artículos con los que los textos se refieren a la criatura; «del» y «al» cuentan como «el». */
const ARTICLES: Record<string, string> = { the: "the", el: "el", la: "la", los: "los", las: "las", del: "el", al: "el" };
/** Palabras que no bastan solas (ni al principio o al final de una parte del nombre). */
const SMALL = new Set(["the", "of", "and", "a", "an", "de", "del", "la", "el", "los", "las", "y", "e", "o", "u"]);

/** Cómo llaman los textos a la criatura: la parte del nombre, con su artículo (o sin él si tiene nombre propio). */
export interface NameRef {
	/** Lo que se guarda en `short_name`: «the dragon», «la saga», «Strahd». */
	ref: string;
	/** La parte del nombre que usan los textos, en minúsculas. */
	part: string;
	/** Artículo (sin él, nombre propio). */
	article?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Las partes seguidas del nombre que pueden servir («Adult Red Dragon» → «dragon», «red dragon»…). Las
 * palabras se separan también por guiones («Will-o'-Wisp» → «wisp»), y cada parte conserva los separadores
 * del nombre.
 */
function nameParts(name: string): string[] {
	const low = name.toLowerCase();
	const words = [...low.matchAll(/[^\s-]+/g)].map((m) => ({ word: m[0], from: m.index ?? 0, to: (m.index ?? 0) + m[0].length }));
	const out: string[] = [];
	for (let i = 0; i < words.length; i++)
		for (let j = i; j < words.length; j++) {
			if (SMALL.has(words[i].word) || SMALL.has(words[j].word)) continue;
			out.push(low.slice(words[i].from, words[j].to));
		}
	return out;
}

const partRe = (part: string, named: boolean) =>
	named
		? new RegExp(`${NOT_LETTER_BEFORE}(${escape(part)})${NOT_LETTER_AFTER}`, "giu")
		: new RegExp(`${NOT_LETTER_BEFORE}(the|el|la|los|las|del|al)\\s+(${escape(part)})${NOT_LETTER_AFTER}`, "giu");

/**
 * Qué parte del nombre usan los textos: la que más veces aparece (con artículo, o sola si la criatura
 * tiene nombre propio); si empatan, la más larga. Null si ninguna aparece.
 */
export function findNameRef(texts: string[], name: string, named: boolean): NameRef | null {
	let best: { part: string; count: number; articles: Map<string, number>; written: string } | null = null;
	for (const part of nameParts(name)) {
		let count = 0;
		const articles = new Map<string, number>();
		let written = "";
		for (const t of texts)
			for (const m of t.matchAll(partRe(part, named))) {
				count++;
				if (!named) {
					const a = ARTICLES[m[1].toLowerCase()];
					articles.set(a, (articles.get(a) ?? 0) + 1);
				}
				if (!written) written = named ? m[1] : m[2];
			}
		if (!count) continue;
		if (!best || count > best.count || (count === best.count && part.length > best.part.length)) best = { part, count, articles, written };
	}
	if (!best) return null;
	if (named) return { ref: best.written, part: best.part };
	const article = [...best.articles].sort((a, b) => b[1] - a[1])[0][0];
	// La parte como se escribe en los textos (en minúscula si empieza así: «the dragon», no «the Dragon»).
	return { ref: `${article} ${best.written}`, part: best.part, article };
}

/**
 * Cambia en un texto la criatura por la marca: «the lich» → `{@name}`, «The lich» → `{@Name}`, «del liche»
 * → «de {@name}», «Al liche» → «A {@name}». Solo con el artículo elegido (la saga ≠ el dragón).
 */
export function insertNameTags(text: string, found: NameRef): string {
	if (!found.article) return text.replace(partRe(found.part, true), "{@name}");
	return text.replace(partRe(found.part, false), (all, art: string) => {
		const low = art.toLowerCase();
		if (ARTICLES[low] !== found.article) return all;
		const upper = art.charAt(0) !== low.charAt(0);
		if (low === "del") return `${upper ? "De" : "de"} {@name}`;
		if (low === "al") return `${upper ? "A" : "a"} {@name}`;
		return upper ? "{@Name}" : "{@name}";
	});
}
