import { App, FileSystemAdapter, normalizePath, Notice } from "obsidian";
import { T } from "../i18n";

/**
 * Iconos SVG personalizados para los pines.
 * Viven en `<carpeta del plugin>/icons/`. Obsidian solo sobrescribe main.js,
 * manifest.json y styles.css al actualizar un plugin, así que esta carpeta se conserva
 * (sí se borra si se desinstala el plugin).
 * En los pines se guardan como `svg:<nombre del archivo sin .svg>`.
 */
export const CUSTOM_ICON_PREFIX = "svg:";

export function customIconName(icon: string): string | null {
	return icon.startsWith(CUSTOM_ICON_PREFIX) ? icon.slice(CUSTOM_ICON_PREFIX.length) : null;
}

/** Archivos que se leen a la vez al cargar la carpeta de iconos. */
const READ_BATCH = 64;

export class IconLibrary {
	/**
	 * nombre → texto del archivo, tal cual (sin sanear). El nombre es la ruta relativa a
	 * la carpeta de iconos, sin «.svg»: «espada» o «armas/espada» si está en una subcarpeta.
	 */
	private raw = new Map<string, string>();
	/**
	 * nombre → <svg> ya saneado, listo para clonar (null = no es un SVG válido).
	 * Cada icono se sanea la primera vez que se pinta, no al cargar: con miles de iconos,
	 * sanearlos todos de golpe bloqueaba Obsidian varios segundos.
	 */
	private parsed = new Map<string, SVGElement | null>();
	readonly dir: string;

	constructor(
		private app: App,
		pluginDir: string,
	) {
		this.dir = normalizePath(`${pluginDir}/icons`);
	}

	names(): string[] {
		return [...this.raw.keys()].sort((a, b) => a.localeCompare(b));
	}

	/** Subcarpetas que contienen iconos ("" = carpeta raíz), ordenadas. */
	folders(): string[] {
		return [...new Set(this.names().map(iconFolder))].sort((a, b) => a.localeCompare(b));
	}

	/**
	 * Lee todos los .svg de la carpeta y sus subcarpetas (la crea si no existe).
	 * Solo lee los archivos, por tandas en paralelo; el saneado se hace al pintar (ver `parsed`).
	 */
	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
		const paths: string[] = [];
		const walk = async (dir: string, depth: number): Promise<void> => {
			const listing = await adapter.list(dir);
			for (const path of listing.files) if (path.toLowerCase().endsWith(".svg")) paths.push(path);
			if (depth < 8) for (const sub of listing.folders) await walk(sub, depth + 1);
		};
		await walk(this.dir, 0);
		const next = new Map<string, string>();
		for (let i = 0; i < paths.length; i += READ_BATCH) {
			await Promise.all(
				paths.slice(i, i + READ_BATCH).map(async (path) => {
					try {
						next.set(path.slice(this.dir.length + 1).replace(/\.svg$/i, ""), await adapter.read(path));
					} catch (e) {
						console.warn(`Strakes TTRPG: couldn't read "${path}"`, e);
					}
				}),
			);
		}
		this.raw = next;
		this.parsed.clear();
	}

	/** <svg> saneado del icono (se sanea y se guarda la primera vez); null si no existe o no es válido. */
	private template(name: string): SVGElement | null {
		const cached = this.parsed.get(name);
		if (cached !== undefined) return cached;
		const text = this.raw.get(name);
		if (text === undefined) return null;
		const svg = sanitizeSvgElement(text);
		if (!svg) console.warn(`Strakes TTRPG: "${this.dir}/${name}.svg" is not a valid SVG.`);
		this.parsed.set(name, svg);
		return svg;
	}

	/**
	 * Copia archivos SVG a la carpeta de iconos (o a una subcarpeta). Si ya existe un icono
	 * con ese nombre, `onConflict` decide: reemplazarlo, guardarlo con otro nombre u omitirlo
	 * (y, con `applyToRest`, hacer lo mismo con los siguientes choques). Sin `onConflict`
	 * nunca se sobrescribe: se usa el siguiente nombre libre. Devuelve cuántos se importaron.
	 */
	async importFiles(files: FileList | File[], folder = "", onConflict?: (c: IconConflict) => Promise<IconConflictChoice>): Promise<number> {
		const adapter = this.app.vault.adapter;
		const target = normalizePath(folder ? `${this.dir}/${folder}` : this.dir);
		if (!(await adapter.exists(target))) await adapter.mkdir(target);
		const pathOf = (name: string) => normalizePath(`${target}/${name}.svg`);
		const exists = (name: string) => adapter.exists(pathOf(safeIconName(name)));
		const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".svg"));
		let sticky: IconConflictChoice["action"] | null = null;
		let count = 0;
		for (const [i, file] of list.entries()) {
			const text = await file.text();
			if (!sanitizeSvg(text)) {
				new Notice(T("icons.isntAValidSvgSkipped", { name: file.name }));
				continue;
			}
			let name = safeIconName(basename(file.name)) || "icono";
			if (await exists(name)) {
				const suggested = await this.freeName(name, exists);
				let choice: IconConflictChoice;
				if (sticky === "replace") choice = { action: "replace" };
				else if (sticky === "skip") choice = { action: "skip" };
				else if (sticky === "rename" || !onConflict) choice = { action: "rename", name: suggested };
				else {
					choice = await onConflict({ name, folder, suggested, remaining: list.length - i - 1, exists });
					if (choice.applyToRest) sticky = choice.action;
				}
				if (choice.action === "skip") continue;
				if (choice.action === "rename") name = safeIconName(choice.name) || suggested;
			}
			await adapter.write(pathOf(name), text);
			count++;
		}
		await this.load();
		return count;
	}

	/** Primer nombre libre añadiendo un número: «espada» → «espada 2», «espada 3»… */
	private async freeName(name: string, exists: (name: string) => Promise<boolean>): Promise<string> {
		for (let n = 2; ; n++) {
			const candidate = `${name} ${n}`;
			if (!(await exists(candidate))) return candidate;
		}
	}

	/** Abre la carpeta de iconos en el explorador de archivos del sistema. */
	openFolder(): void {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const full = adapter.getFullPath(this.dir);
		try {
			const electron = (window as unknown as { require: (m: string) => { shell: { openPath(p: string): Promise<string> } } }).require("electron");
			void electron.shell.openPath(full);
		} catch {
			new Notice(T("icons.iconsFolder", { full }));
		}
	}

	/**
	 * Pinta el icono dentro de `el`. Devuelve false si no existe.
	 * Se crea un elemento nuevo en cada llamada (cada pin necesita el suyo).
	 * Con `color`, el icono se recolorea entero de ese color (el archivo no cambia).
	 */
	render(el: HTMLElement, name: string, color?: string): boolean {
		const template = this.template(name);
		if (!template) return false;
		const svg = el.doc.importNode(template, true);
		if (color) recolorSvg(svg, color);
		svg.classList.add("strakes-custom-icon");
		el.appendChild(svg);
		return true;
	}
}

/** Un choque al importar: ya existe un icono con ese nombre en la carpeta de destino. */
export interface IconConflict {
	name: string;
	/** Subcarpeta de destino ("" = carpeta principal). */
	folder: string;
	/** Primer nombre libre («espada 2»). */
	suggested: string;
	/** Archivos que quedan por importar después de este. */
	remaining: number;
	/** ¿Existe ya un icono con este nombre en esa carpeta? */
	exists: (name: string) => Promise<boolean>;
}

/** Qué hacer con un choque. `applyToRest`: lo mismo con los siguientes (al renombrar, con el siguiente nombre libre). */
export type IconConflictChoice = ({ action: "replace" } | { action: "rename"; name: string } | { action: "skip" }) & { applyToRest?: boolean };

/** Nombre de archivo válido para un icono: sin los caracteres que no admiten las rutas ni los enlaces. */
function safeIconName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
}

/** Carpeta de un icono por su nombre ("armas/espada" → "armas"; "espada" → ""). */
export function iconFolder(name: string): string {
	const i = name.lastIndexOf("/");
	return i >= 0 ? name.slice(0, i) : "";
}


/**
 * Pinta todas las formas del SVG de un color: cambia los rellenos y trazos que no
 * sean «none» (atributos, estilos en línea y hojas <style> internas). Las formas sin
 * color propio heredan el relleno del <svg> raíz, que también se fija.
 */
function recolorSvg(svg: SVGElement, color: string): void {
	const replaceInCss = (css: string) => css.replace(/((?:fill|stroke)\s*:\s*)(?!none\b)([^;}"']+)/gi, `$1${color}`);
	for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
		for (const prop of ["fill", "stroke"]) {
			const v = el.getAttribute(prop);
			if (v && v.trim().toLowerCase() !== "none") el.setAttribute(prop, color);
		}
		const style = el.getAttribute("style");
		if (style) el.setAttribute("style", replaceInCss(style));
		if (el.tagName.toLowerCase() === "style" && el.textContent) el.textContent = replaceInCss(el.textContent);
	}
	const rootFill = svg.getAttribute("fill");
	if (!rootFill || rootFill.trim().toLowerCase() !== "none") svg.setAttribute("fill", color);
}

function basename(path: string): string {
	return (path.split("/").pop() ?? path).replace(/\.svg$/i, "");
}

/**
 * Sanea un SVG: quita scripts, atributos de evento y enlaces externos.
 * Conserva sus colores originales. Devuelve null si no es un SVG válido.
 */
export function sanitizeSvg(text: string): string | null {
	const svg = sanitizeSvgElement(text);
	return svg ? new XMLSerializer().serializeToString(svg) : null;
}

/** Como `sanitizeSvg`, pero devuelve el elemento <svg> ya saneado (sin pasarlo a texto). */
function sanitizeSvgElement(text: string): SVGElement | null {
	const doc = new DOMParser().parseFromString(text, "image/svg+xml");
	const svg = doc.documentElement as unknown as SVGElement | null;
	if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;

	// Elementos peligrosos o que cargan contenido externo. Se comparan por nombre local
	// (sin prefijo, para que «html:iframe» no se cuele) y se quita todo lo que esté en el
	// espacio de nombres de HTML.
	for (const el of Array.from(svg.getElementsByTagName("*"))) {
		const name = el.localName.toLowerCase();
		const animatesLink = (name === "set" || name === "animate") && /href$/i.test(el.getAttribute("attributeName") ?? "");
		if (BLOCKED_ELEMENTS.has(name) || el.namespaceURI === XHTML_NS || animatesLink) el.remove();
	}

	const all = [svg, ...Array.from(svg.getElementsByTagName("*"))];
	for (const el of all) {
		// <style> interno: sin @import ni url(...) externos.
		if (el.localName.toLowerCase() === "style") {
			const css = sanitizeCss(el.textContent ?? "");
			if (css === null) {
				el.remove();
				continue;
			}
			el.textContent = css;
		}
		for (const attr of Array.from(el.attributes)) {
			const n = attr.localName.toLowerCase();
			if (n.startsWith("on")) {
				el.removeAttribute(attr.name);
				continue;
			}
			// Enlaces y fuentes: solo referencias internas (#id) o imágenes incrustadas (data:image/).
			if ((n === "href" || n === "src" || n === "srcset") && !isInternalRef(attr.value)) {
				el.removeAttribute(attr.name);
				continue;
			}
			// style="…" y atributos con url(…) (p. ej. fill="url(#degradado)"): sin recursos externos.
			if (n === "style" || /url\s*\(|image-set\s*\(/i.test(attr.value)) {
				const css = sanitizeCss(attr.value);
				if (css === null) el.removeAttribute(attr.name);
				else if (css !== attr.value) el.setAttribute(attr.name, css);
			}
		}
	}

	// Tamaño: lo controla el CSS del pin; aseguramos un viewBox para que escale.
	if (!svg.getAttribute("viewBox")) {
		const w = parseFloat(svg.getAttribute("width") ?? "");
		const h = parseFloat(svg.getAttribute("height") ?? "");
		if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	}
	svg.removeAttribute("width");
	svg.removeAttribute("height");
	// Los colores del SVG se respetan tal cual.
	return svg;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Elementos que se eliminan siempre de un SVG (nombre local, en minúsculas). */
const BLOCKED_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "link", "meta", "base"]);

/** Referencia que no sale del propio SVG: «#id» o una imagen incrustada «data:image/…». */
function isInternalRef(value: string): boolean {
	const v = value.trim().toLowerCase();
	return v.startsWith("#") || v.startsWith("data:image/");
}

/**
 * Limpia CSS de un SVG: quita las reglas @import y cambia por «none» los url(…) e
 * image-set(…) que apunten fuera del SVG (se conservan url(#id) y las imágenes data:image/).
 * Devuelve null si el CSS contiene escapes con «\»: con ellos se puede disfrazar un url(…),
 * así que ese CSS se descarta entero (en iconos normales no aparecen).
 */
function sanitizeCss(css: string): string | null {
	if (css.includes("\\")) return null;
	return css
		.replace(/@import[^;]*;?/gi, "")
		.replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match: string, _quote: string, target: string) => (isInternalRef(target) ? match : "none"))
		.replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, "none");
}

/** Biblioteca compartida (la crea el plugin al cargar). */
let library: IconLibrary | null = null;

export function setIconLibrary(lib: IconLibrary | null): void {
	library = lib;
}

export function getIconLibrary(): IconLibrary | null {
	return library;
}
