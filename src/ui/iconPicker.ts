import { ColorComponent, setIcon, Setting, setTooltip } from "obsidian";
import { T } from "../i18n";
import { CUSTOM_ICON_PREFIX, customIconName, getIconLibrary, iconFolder } from "../map/icons";
import { iconSupportsColor } from "../map/render";

/**
 * Selector de icono compartido (marcadores y condiciones personalizadas):
 * campo de texto (emoji, letra o Lucide) y cuadrícula de SVG de la carpeta de iconos,
 * con filtro por carpeta, búsqueda por nombre y botón de recargar.
 */
export interface IconPickerOptions {
	icon: string;
	/** Color con el que se previsualizan los SVG (undefined = colores nativos). */
	iconColor?: string;
	/** Fondo de los recuadros (color del marcador); null = sin fondo propio. */
	background: string | null;
	onChange: (icon: string) => void;
	/** Vuelve a leer la carpeta de iconos (botón ↻). */
	reload?: () => Promise<void>;
	placeholder?: string;
}

export class IconPicker {
	private input: HTMLInputElement | null = null;
	private box: HTMLElement;
	private tilesEl: HTMLElement | null = null;
	/** Filtro de carpeta: "*" = todas, "" = carpeta principal. */
	private folder = "*";
	private query = "";
	/** Pinta los SVG de los recuadros solo cuando entran en pantalla (ver renderTiles). */
	private observer: IntersectionObserver | null = null;
	private searchTimer: number | null = null;

	constructor(
		parent: HTMLElement,
		private opts: IconPickerOptions,
	) {
		const custom = customIconName(opts.icon ?? "");
		new Setting(parent)
			.setName(T("Icono", "Icon"))
			.setDesc(T("Un emoji, una letra o un icono de Lucide (ej. castle, skull, tent), o uno de tus SVG de abajo.", "An emoji, a letter or a Lucide icon name (e.g. castle, skull, tent), or one of your SVGs below."))
			.addText((t) => {
				this.input = t.inputEl;
				t.setPlaceholder(custom !== null ? `SVG: ${custom}` : (opts.placeholder ?? "📍"))
					.setValue(custom !== null ? "" : opts.icon)
					.onChange((v) => {
						this.opts.icon = v.trim();
						this.updateSelection();
						this.opts.onChange(this.opts.icon);
					});
			});
		this.box = parent.createDiv("strakes-icon-picker");
		this.buildGrid();
	}


	setIconColor(color: string | undefined): void {
		this.opts.iconColor = color;
		this.renderTiles();
	}

	setBackground(color: string | null): void {
		this.opts.background = color;
		this.applyBackground();
	}

	private applyBackground(): void {
		const grid = this.tilesEl;
		if (!grid) return;
		grid.toggleClass("no-background", !this.opts.background);
		if (this.opts.background) grid.setCssProps({ "--pin-color": this.opts.background });
		else grid.setCssProps({ "--pin-color": "" });
	}

	private buildGrid(): void {
		const lib = getIconLibrary();
		const box = this.box;
		box.empty();
		if (!lib) return;
		const filters = box.createDiv("strakes-icon-filters");
		const folders = lib.folders();
		if (folders.some((f) => f !== "")) {
			const select = filters.createEl("select", { cls: "dropdown" });
			select.createEl("option", { value: "*", text: T("Todas las carpetas", "All folders") });
			for (const f of folders) select.createEl("option", { value: f, text: f === "" ? T("(Carpeta principal)", "(Main folder)") : f });
			select.value = folders.includes(this.folder) || this.folder === "*" ? this.folder : "*";
			select.onchange = () => {
				this.folder = select.value;
				this.renderTiles();
			};
		}
		const search = filters.createEl("input", { type: "search", attr: { placeholder: T("Buscar icono…", "Search icons…") } });
		search.value = this.query;
		// Con muchos iconos, filtrar en cada tecla se nota: se espera a que deje de escribir.
		search.oninput = () => {
			this.query = search.value;
			if (this.searchTimer !== null) search.win.clearTimeout(this.searchTimer);
			this.searchTimer = search.win.setTimeout(() => {
				this.searchTimer = null;
				this.renderTiles();
			}, 150);
		};
		if (this.opts.reload) {
			const reload = this.opts.reload;
			const b = filters.createEl("button", { cls: "clickable-icon strakes-icon-reload" });
			setIcon(b, "refresh-cw");
			setTooltip(b, T("Recargar iconos de la carpeta", "Reload icons from the folder"));
			b.onclick = () => void reload().then(() => this.buildGrid());
		}
		this.tilesEl = box.createDiv("strakes-icon-grid");
		this.applyBackground();
		this.renderTiles();
	}

	/**
	 * Recuadros: fondo del color del marcador (o neutro), icono con su color; el elegido, con
	 * borde blanco. Se crean todos los recuadros (vacíos, ligeros), pero cada SVG solo se pinta
	 * cuando su recuadro entra en la zona visible de la cuadrícula: con miles de iconos,
	 * pintarlos todos a la vez bloqueaba el diálogo.
	 */
	private renderTiles(): void {
		const grid = this.tilesEl;
		const lib = getIconLibrary();
		if (!grid || !lib) return;
		this.observer?.disconnect();
		this.observer = null;
		grid.empty();
		const all = lib.names();
		if (!all.length) {
			grid.addClass("is-empty");
			grid.createDiv({
				cls: "setting-item-description",
				text: T(
					"Aún no tienes iconos SVG. Impórtalos desde los ajustes del plugin o cópialos (también en subcarpetas) en su carpeta de iconos y pulsa ↻.",
					"You don't have any SVG icons yet. Import them from the plugin settings, or copy them (subfolders work too) into its icons folder and press ↻.",
				),
			});
			return;
		}
		grid.removeClass("is-empty");
		const q = this.query.trim().toLowerCase();
		const folder = this.folder;
		const shown = all.filter((name) => {
			const f = iconFolder(name);
			if (folder !== "*" && f !== folder && !f.startsWith(`${folder}/`)) return false;
			return !q || name.toLowerCase().includes(q);
		});
		if (!shown.length) {
			grid.addClass("is-empty");
			grid.createDiv({ cls: "setting-item-description", text: T("Ningún icono coincide con el filtro.", "No icons match the filter.") });
			return;
		}
		const color = this.opts.iconColor;
		const names = new Map<Element, string>();
		// IntersectionObserver de la ventana del propio elemento (puede ser una ventana emergente).
		const win = grid.win as Window & { IntersectionObserver: typeof IntersectionObserver };
		const observer = new win.IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					observer.unobserve(entry.target);
					const name = names.get(entry.target);
					// Un archivo que no es un SVG válido no se muestra.
					if (name !== undefined && !lib.render(entry.target as HTMLElement, name, color)) (entry.target as HTMLElement).hide();
				}
			},
			{ root: grid, rootMargin: "200px 0px" },
		);
		this.observer = observer;
		for (const name of shown) {
			const value = `${CUSTOM_ICON_PREFIX}${name}`;
			const tile = grid.createEl("button", { cls: "strakes-icon-tile", attr: { "data-icon": value } });
			tile.toggleClass("is-selected", this.opts.icon === value);
			setTooltip(tile, name);
			names.set(tile, name);
			observer.observe(tile);
			tile.onclick = () => {
				this.opts.icon = this.opts.icon === value ? "" : value;
				if (this.input) {
					this.input.value = "";
					this.input.placeholder = this.opts.icon ? `SVG: ${name}` : (this.opts.placeholder ?? "📍");
				}
				this.updateSelection();
				this.opts.onChange(this.opts.icon);
			};
		}
	}

	/** Marca el recuadro del icono elegido sin volver a pintar la cuadrícula. */
	private updateSelection(): void {
		const grid = this.tilesEl;
		if (!grid) return;
		for (const tile of Array.from(grid.querySelectorAll<HTMLElement>(".strakes-icon-tile")))
			tile.toggleClass("is-selected", tile.getAttribute("data-icon") === this.opts.icon);
	}
}

/**
 * Color del icono: selector de color y casilla «Color nativo». Marcada = colores
 * originales (SVG con sus colores; Lucide y letras en blanco) y el selector se desactiva.
 * Los emojis no se pueden recolorear: casilla marcada y bloqueada.
 */
export class IconColorControl {
	private last: string;

	constructor(
		private host: HTMLElement,
		private opts: {
			label: string;
			getIcon: () => string;
			color?: string;
			defaultColor: string;
			onChange: (color: string | undefined) => void;
		},
	) {
		this.last = opts.color ?? opts.defaultColor;
		this.render();
	}

	/** Volver a pintar (p. ej. si el icono pasa a ser un emoji). */
	refresh(): void {
		this.render();
	}

	private render(): void {
		const host = this.host;
		host.empty();
		host.createSpan({ cls: "strakes-color-label", text: this.opts.label });
		const canColor = iconSupportsColor(this.opts.getIcon() ?? "");
		const color = this.opts.color;
		const native = !canColor || !color;
		if (color) this.last = color;

		const picker = new ColorComponent(host).setValue(color ?? this.last).onChange((v) => {
			this.opts.color = v;
			this.last = v;
			this.opts.onChange(v);
		});
		picker.setDisabled(native);

		const label = host.createEl("label", { cls: "strakes-native-check" });
		const check = label.createEl("input", { type: "checkbox" });
		check.checked = native;
		check.disabled = !canColor;
		label.appendText(T("Color nativo", "Native color"));
		if (!canColor) setTooltip(label, T("Los emojis tienen sus propios colores y no se pueden recolorear", "Emojis have their own colors and can't be recolored"));
		check.onchange = () => {
			// Al desmarcar se recupera el último color elegido.
			this.opts.color = check.checked ? undefined : this.last;
			this.opts.onChange(this.opts.color);
			this.render();
		};
	}
}
