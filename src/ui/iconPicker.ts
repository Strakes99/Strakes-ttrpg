import { ColorComponent, setIcon, Setting, setTooltip } from "obsidian";
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

	constructor(
		parent: HTMLElement,
		private opts: IconPickerOptions,
	) {
		const custom = customIconName(opts.icon ?? "");
		new Setting(parent)
			.setName("Icono")
			.setDesc("Un emoji, una letra o un icono de Lucide (ej. castle, skull, tent), o uno de tus SVG de abajo.")
			.addText((t) => {
				this.input = t.inputEl;
				t.setPlaceholder(custom !== null ? `SVG: ${custom}` : (opts.placeholder ?? "📍"))
					.setValue(custom !== null ? "" : opts.icon)
					.onChange((v) => {
						this.opts.icon = v.trim();
						this.renderTiles();
						this.opts.onChange(this.opts.icon);
					});
			});
		this.box = parent.createDiv("strakes-icon-picker");
		this.buildGrid();
	}

	get icon(): string {
		return this.opts.icon;
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
		if (this.opts.background) grid.style.setProperty("--pin-color", this.opts.background);
		else grid.style.removeProperty("--pin-color");
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
			select.createEl("option", { value: "*", text: "Todas las carpetas" });
			for (const f of folders) select.createEl("option", { value: f, text: f === "" ? "(Carpeta principal)" : f });
			select.value = folders.includes(this.folder) || this.folder === "*" ? this.folder : "*";
			select.onchange = () => {
				this.folder = select.value;
				this.renderTiles();
			};
		}
		const search = filters.createEl("input", { type: "search", attr: { placeholder: "Buscar icono…" } });
		search.value = this.query;
		search.oninput = () => {
			this.query = search.value;
			this.renderTiles();
		};
		if (this.opts.reload) {
			const reload = this.opts.reload;
			const b = filters.createEl("button", { cls: "clickable-icon strakes-icon-reload" });
			setIcon(b, "refresh-cw");
			setTooltip(b, "Recargar iconos de la carpeta");
			b.onclick = () => void reload().then(() => this.buildGrid());
		}
		this.tilesEl = box.createDiv("strakes-icon-grid");
		this.applyBackground();
		this.renderTiles();
	}

	/** Recuadros: fondo del color del marcador (o neutro), icono con su color; el elegido, con borde blanco. */
	private renderTiles(): void {
		const grid = this.tilesEl;
		const lib = getIconLibrary();
		if (!grid || !lib) return;
		grid.empty();
		const all = lib.names();
		if (!all.length) {
			grid.addClass("is-empty");
			grid.createDiv({
				cls: "setting-item-description",
				text: "Aún no tienes iconos SVG. Impórtalos desde los ajustes del plugin o cópialos (también en subcarpetas) en su carpeta de iconos y pulsa ↻.",
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
			grid.createDiv({ cls: "setting-item-description", text: "Ningún icono coincide con el filtro." });
			return;
		}
		for (const name of shown) {
			const value = `${CUSTOM_ICON_PREFIX}${name}`;
			const tile = grid.createEl("button", { cls: "strakes-icon-tile" });
			tile.toggleClass("is-selected", this.opts.icon === value);
			lib.render(tile, name, this.opts.iconColor);
			setTooltip(tile, name);
			tile.onclick = () => {
				this.opts.icon = this.opts.icon === value ? "" : value;
				if (this.input) {
					this.input.value = "";
					this.input.placeholder = this.opts.icon ? `SVG: ${name}` : (this.opts.placeholder ?? "📍");
				}
				this.renderTiles();
				this.opts.onChange(this.opts.icon);
			};
		}
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
		label.appendText("Color nativo");
		if (!canColor) setTooltip(label, "Los emojis tienen sus propios colores y no se pueden recolorear");
		check.onchange = () => {
			// Al desmarcar se recupera el último color elegido.
			this.opts.color = check.checked ? undefined : this.last;
			this.opts.onChange(this.opts.color);
			this.render();
		};
	}
}
