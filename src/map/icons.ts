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

export class IconLibrary {
	/**
	 * nombre → SVG ya saneado (texto). El nombre es la ruta relativa a la carpeta de
	 * iconos, sin «.svg»: «espada» o «armas/espada» si está en una subcarpeta.
	 */
	private icons = new Map<string, string>();
	readonly dir: string;

	constructor(
		private app: App,
		pluginDir: string,
	) {
		this.dir = normalizePath(`${pluginDir}/icons`);
	}

	names(): string[] {
		return [...this.icons.keys()].sort((a, b) => a.localeCompare(b));
	}

	has(name: string): boolean {
		return this.icons.has(name);
	}

	/** Subcarpetas que contienen iconos ("" = carpeta raíz), ordenadas. */
	folders(): string[] {
		return [...new Set(this.names().map(iconFolder))].sort((a, b) => a.localeCompare(b));
	}

	/** Lee todos los .svg de la carpeta y sus subcarpetas (la crea si no existe). */
	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
		const next = new Map<string, string>();
		const walk = async (dir: string, depth: number): Promise<void> => {
			const listing = await adapter.list(dir);
			for (const path of listing.files) {
				if (!path.toLowerCase().endsWith(".svg")) continue;
				try {
					const clean = sanitizeSvg(await adapter.read(path));
					if (clean) next.set(path.slice(this.dir.length + 1).replace(/\.svg$/i, ""), clean);
					else console.warn(`Strakes TTRPG: "${path}" is not a valid SVG.`);
				} catch (e) {
					console.warn(`Strakes TTRPG: couldn't read "${path}"`, e);
				}
			}
			if (depth < 8) for (const sub of listing.folders) await walk(sub, depth + 1);
		};
		await walk(this.dir, 0);
		this.icons = next;
	}

	/**
	 * Copia archivos SVG elegidos por el usuario a la carpeta de iconos
	 * (o a una subcarpeta). Devuelve cuántos se importaron.
	 */
	async importFiles(files: FileList | File[], folder = ""): Promise<number> {
		const adapter = this.app.vault.adapter;
		const target = normalizePath(folder ? `${this.dir}/${folder}` : this.dir);
		if (!(await adapter.exists(target))) await adapter.mkdir(target);
		let count = 0;
		for (const file of Array.from(files)) {
			if (!file.name.toLowerCase().endsWith(".svg")) continue;
			const text = await file.text();
			if (!sanitizeSvg(text)) {
				new Notice(T(`«${file.name}» no es un SVG válido; se omitió.`, `"${file.name}" isn't a valid SVG; skipped.`));
				continue;
			}
			const name = basename(file.name).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "icono";
			await adapter.write(normalizePath(`${target}/${name}.svg`), text);
			count++;
		}
		await this.load();
		return count;
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
			new Notice(T(`Carpeta de iconos: ${full}`, `Icons folder: ${full}`));
		}
	}

	/**
	 * Pinta el icono dentro de `el`. Devuelve false si no existe.
	 * Se crea un elemento nuevo en cada llamada (cada pin necesita el suyo).
	 * Con `color`, el icono se recolorea entero de ese color (el archivo no cambia).
	 */
	render(el: HTMLElement, name: string, color?: string): boolean {
		const markup = this.icons.get(name);
		if (!markup) return false;
		const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
		const svg = el.doc.importNode(doc.documentElement, true) as unknown as SVGElement;
		if (color) recolorSvg(svg, color);
		svg.classList.add("strakes-custom-icon");
		el.appendChild(svg);
		return true;
	}
}

/** Carpeta de un icono por su nombre ("armas/espada" → "armas"; "espada" → ""). */
export function iconFolder(name: string): string {
	const i = name.lastIndexOf("/");
	return i >= 0 ? name.slice(0, i) : "";
}

/** Nombre corto del icono, sin carpeta. */
export function iconLabel(name: string): string {
	return name.slice(name.lastIndexOf("/") + 1);
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
	const doc = new DOMParser().parseFromString(text, "image/svg+xml");
	const svg = doc.documentElement;
	if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;

	for (const tag of ["script", "foreignObject", "iframe", "object", "embed"])
		for (const el of Array.from(svg.getElementsByTagName(tag))) el.remove();

	const all = [svg, ...Array.from(svg.getElementsByTagName("*"))];
	for (const el of all) {
		for (const attr of Array.from(el.attributes)) {
			const n = attr.name.toLowerCase();
			const v = attr.value.trim().toLowerCase();
			if (n.startsWith("on")) el.removeAttribute(attr.name);
			else if ((n === "href" || n === "xlink:href") && !v.startsWith("#") && !v.startsWith("data:image/")) el.removeAttribute(attr.name);
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
	return new XMLSerializer().serializeToString(svg);
}

/** Biblioteca compartida (la crea el plugin al cargar). */
let library: IconLibrary | null = null;

export function setIconLibrary(lib: IconLibrary | null): void {
	library = lib;
}

export function getIconLibrary(): IconLibrary | null {
	return library;
}
