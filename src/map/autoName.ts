import { parseWikilink } from "./links";

/**
 * Nombre automático de los marcadores, las rutas y las zonas (casilla AUTO de sus diálogos).
 *
 * Orden: alias del enlace > último encabezado > nombre de la nota > nombre del marcador
 * destino (lo último, solo portales). Todo sale del texto del enlace y de los nombres ya guardados:
 * no se lee ninguna nota ni hay nada que se revise de forma continua. Se recalcula solo en
 * momentos concretos: al editar o guardar un marcador, una ruta o una zona, al elegir el destino de un portal y
 * al renombrar o mover una nota (ver `applyAutoNames`).
 */

/** Lo que hace falta de un marcador. Los datos pueden venir de un .smap escrito a mano. */
export interface AutoNamePin {
	id: string;
	name?: unknown;
	link?: unknown;
	portal?: unknown;
	targetPinId?: unknown;
	autoName?: unknown;
}

/** Extensiones que se quitan del nombre de la nota (las notas Markdown no la llevan en el enlace). */
const LINKED_FILE_EXTENSION = /\.(md|smap|canvas)$/i;

/** Quita el formato Markdown habitual de un encabezado o alias: «La **Torre** de [[Strahd]]» → «La Torre de Strahd». */
export function plainText(text: string): string {
	return text
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/\[\[([^\]]*)\]\]/g, (_m: string, target: string) => (target.split("#")[0].split("/").pop() ?? target).replace(LINKED_FILE_EXTENSION, ""))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/\*\*|__|~~|==|`|\*/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Nombre que da el enlace de un marcador, una ruta o una zona: el alias si lo tiene, si no el último encabezado
 * («Nota#Capítulo#Sección» → «Sección»), y si no el nombre de la nota (también con
 * referencias a bloques «#^id» y con enlaces rotos). null si no hay enlace.
 */
export function nameFromLink(link: unknown): string | null {
	if (typeof link !== "string" || !link.trim()) return null;
	const { linkpath, subpath, alias } = parseWikilink(link);
	if (alias) {
		const a = plainText(alias);
		if (a) return a;
	}
	if (subpath && !subpath.startsWith("#^")) {
		const parts = subpath.split("#").filter((s) => s.trim());
		const last = parts.length ? plainText(parts[parts.length - 1]) : "";
		if (last) return last;
	}
	const note = (linkpath.split("/").pop() ?? "").replace(LINKED_FILE_EXTENSION, "").trim();
	return note || null;
}

const nameOf = (pin: AutoNamePin): string => (typeof pin.name === "string" ? pin.name.trim() : "");

/** ¿El nombre de este marcador sale de su destino (AUTO, portal, sin enlace)? */
function nameComesFromTarget(pin: AutoNamePin): boolean {
	return pin.autoName === true && pin.portal === true && nameFromLink(pin.link) === null;
}

/**
 * Nombre automático de un marcador, o null si no hay de dónde sacarlo. Un portal no toma
 * el nombre de otro portal cuyo nombre también viene de su destino: dos escaleras que se
 * apuntan entre sí se intercambiarían el nombre en cada guardado.
 */
export function autoPinName(pin: AutoNamePin, pins: readonly AutoNamePin[]): string | null {
	const fromLink = nameFromLink(pin.link);
	if (fromLink) return fromLink;
	if (pin.portal !== true || typeof pin.targetPinId !== "string") return null;
	const target = pins.find((p) => p.id === pin.targetPinId);
	if (!target || target.id === pin.id || nameComesFromTarget(target)) return null;
	return nameOf(target) || null;
}

/**
 * Recalcula los nombres de todos los elementos con AUTO de una lista (marcadores, rutas o zonas): primero los que salen
 * de su enlace y después los de los portales (con los nombres ya actualizados). Si un
 * marcador no tiene de dónde sacar el nombre, conserva el que tenía. Devuelve true si
 * cambió algún nombre.
 */
export function applyAutoNames(pins: AutoNamePin[]): boolean {
	let changed = false;
	const set = (pin: AutoNamePin, name: string | null) => {
		if (name && name !== pin.name) {
			pin.name = name;
			changed = true;
		}
	};
	for (const pin of pins) if (pin.autoName === true) set(pin, nameFromLink(pin.link));
	for (const pin of pins) if (nameComesFromTarget(pin)) set(pin, autoPinName(pin, pins));
	return changed;
}
