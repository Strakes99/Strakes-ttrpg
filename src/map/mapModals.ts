import { App, ColorComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { T } from "../i18n";
import { uid } from "../types";
import { FileInputSuggest, isImageFile, promptText } from "../ui/modals";
import { decimalInput, parseDecimal } from "../ui/dom";
import { IconColorControl, IconPicker } from "../ui/iconPicker";
import { autoPinName, nameFromLink } from "./autoName";
import { makeWikilink, parseWikilink, resolveWikilink, wikilinkFor } from "./links";
import { DEFAULT_ICON_COLOR, formatHours, MapData, MapLayer, parseHoursInput, segmentTime, MapPin, MapRoute, MapZone, nodeMap, segmentDistance, fieldNumber, unitFactor, unitOptions } from "./mapData";
import { zoneArea } from "./zones";
import { DEFAULT_FOG_COLOR } from "./fogData";

// ---------- Tramo (clic en la etiqueta) ----------

export interface SegmentEdit {
	/** Distancia manual (null = estimada por la escala / sin definir). */
	distance: number | null;
	/** Tiempo manual en horas a paso normal (null = calcular desde la distancia). */
	time: number | null;
}

/** Diálogo para editar la distancia y el tiempo de viaje de un tramo. Resuelve null si se cancela. */
export function editSegmentDialog(app: App, data: MapData, route: MapRoute, i: number): Promise<SegmentEdit | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let done = false;
		const nodes = nodeMap(data);
		const result: SegmentEdit = { distance: route.segments[i] ?? null, time: route.times?.[i] ?? null };
		const estDist = segmentDistance(data, { ...route, segments: route.segments.map(() => null) }, i, nodes).value;
		const estTime = segmentTime(data, { ...route, times: [] }, i, "normal", nodes).hours;

		const routeName = route.name.trim() ? ` · ${route.name}` : "";
		modal.titleEl.setText(T(`Tramo ${i + 1}${routeName}`, `Segment ${i + 1}${routeName}`));
		const el = modal.contentEl;
		const save = () => {
			if (result.distance !== null && result.distance < 0) warnNegativeDistances([i]);
			done = true;
			resolve(result);
			modal.close();
		};
		const onEnter = (input: HTMLInputElement) =>
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					save();
				}
			});

		let distInput: HTMLInputElement | null = null;
		new Setting(el)
			.setName(T(`Distancia (${data.unit || "sin unidad"})`, `Distance (${data.unit || "no unit"})`))
			.setDesc(
				data.scale
					? T("Vacío = la estimada por la escala del mapa.", "Empty = estimated from the map scale.")
					: T("El mapa no tiene escala: escribe la distancia real.", "The map has no scale: enter the real distance."),
			)
			.addText((t) => {
				distInput = t.inputEl;
				decimalInput(t.inputEl);
				t.setPlaceholder(estDist !== null ? `≈ ${fieldNumber(estDist)}` : "?");
				t.setValue(result.distance === null ? "" : fieldNumber(result.distance));
				t.onChange((v) => {
					const n = parseDecimal(v);
					result.distance = isNaN(n) ? null : n;
				});
				onEnter(t.inputEl);
			});
		new Setting(el)
			.setName(T("Tiempo de viaje (paso normal)", "Travel time (normal pace)"))
			.setDesc(
				T(
					"Horas, ej. 6, 6,5 o 6h 30m. Vacío = se calcula desde la distancia. Los pasos lento y rápido se ajustan a partir de este tiempo.",
					"Hours, e.g. 6, 6.5 or 6h 30m. Empty = calculated from the distance. Slow and fast paces are adjusted from this time.",
				),
			)
			.addText((t) => {
				t.setPlaceholder(estTime !== null ? `≈ ${formatHours(estTime)}` : "?");
				t.setValue(result.time === null ? "" : formatHours(result.time));
				t.inputEl.addClass("strakes-seg-time");
				t.onChange((v) => {
					const h = parseHoursInput(v);
					t.inputEl.toggleClass("is-invalid", v.trim() !== "" && h === null);
					result.time = h !== null && h > 0 ? h : null;
				});
				onEnter(t.inputEl);
			});
		new Setting(el)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => modal.close()))
			.addButton((b) => b.setButtonText(T("Guardar", "Save")).setCta().onClick(save));

		modal.onClose = () => {
			if (!done) resolve(null);
		};
		modal.open();
		window.setTimeout(() => {
			distInput?.focus();
			distInput?.select();
		}, 10);
	});
}

/**
 * Desplegable de capa de los diálogos de marcador, ruta y zona: «Sin capa», las capas del
 * usuario y la opción de crear una nueva. Las capas creadas aquí van a
 * `pending` (del diálogo) y no al mapa: solo se añaden al guardar (`commitLayers`), así
 * que cancelar el diálogo no deja capas nuevas en el mapa.
 */
function layerDropdown(
	app: App,
	setting: Setting,
	data: MapData,
	pending: MapLayer[],
	value: string | null,
	onChange: (id: string | null) => void,
	rerender: () => void,
): void {
	setting.addDropdown((dd) => {
		dd.addOption("", T("— Sin capa —", "— No layer —"));
		for (const l of [...data.layers, ...pending]) dd.addOption(l.id, l.name);
		dd.addOption("__new__", T("➕ Nueva capa…", "➕ New layer…"));
		dd.setValue(value ?? "");
		dd.onChange(async (v) => {
			if (v !== "__new__") return onChange(v || null);
			const name = await promptText(app, T("Nueva capa", "New layer"), { placeholder: T("Nombre de la capa", "Layer name") });
			if (name && name.trim()) {
				const layer = { id: uid(), name: name.trim(), visible: true };
				pending.push(layer);
				onChange(layer.id);
			}
			rerender();
		});
	});
}

/**
 * Las distancias negativas se guardan (alguien puede querer usarlas), pero se avisa: la
 * medición del camino más corto da resultados extraños con ellas. `segments`: índices (0-based).
 */
function warnNegativeDistances(segments: number[]): void {
	const list = segments.map((i) => i + 1).join(", ");
	const many = segments.length > 1;
	new Notice(
		T(
			`${many ? "Los tramos" : "El tramo"} ${list} ${many ? "tienen" : "tiene"} distancia negativa. Se guarda igual, pero la medición del camino más corto puede dar resultados extraños.`,
			`Segment${many ? "s" : ""} ${list} ${many ? "have" : "has"} a negative distance. It's saved anyway, but shortest-path measuring may give odd results.`,
		),
		8000,
	);
}

/** Añade al mapa las capas creadas en un diálogo (al guardarlo). */
function commitLayers(data: MapData, pending: MapLayer[]): void {
	for (const layer of pending) if (!data.layers.some((l) => l.id === layer.id)) data.layers.push(layer);
	pending.length = 0;
}

// ---------- Pin ----------

export interface PinModalResult {
	action: "save" | "delete" | "pick-target";
	pin: MapPin;
}

/** Acciones sobre la carpeta de iconos que el diálogo ofrece (las implementa el plugin). */
export interface PinIconActions {
	/** Vuelve a leer la carpeta de iconos. */
	reload(): Promise<void>;
}

/**
 * Fila de botones de un diálogo (Eliminar | Cancelar | Guardar) en un pie fuera del contenido:
 * siempre visible aunque el contenido obligue a desplazarse (accesibilidad; pedido del
 * desarrollador). El contenido se desplaza en su propio hueco (ver .strakes-has-footer en
 * styles.css). Se vacía y se reutiliza en cada render() del diálogo.
 */
function modalFooter(modal: Modal): Setting {
	modal.modalEl.addClass("strakes-has-footer");
	let footer = modal.modalEl.querySelector<HTMLElement>(":scope > .strakes-modal-footer");
	if (footer) footer.empty();
	else footer = modal.modalEl.createDiv("strakes-modal-footer");
	return new Setting(footer);
}

export class PinModal extends Modal {
	private pin: MapPin;
	/** Capas creadas en este diálogo; se añaden al mapa solo al guardar. */
	private newLayers: MapLayer[] = [];
	/** Nombre con AUTO y nota: como en zonas y rutas, pero el nombre AUTO puede salir del destino del portal. */
	private fields: NameLinkFields;
	private firstRender = true;
	private iconPicker: IconPicker | null = null;
	private iconColor: IconColorControl | null = null;

	constructor(
		app: App,
		private data: MapData,
		pin: MapPin,
		private isNew: boolean,
		sourcePath: string,
		private onDone: (r: PinModalResult) => void,
		private iconActions: PinIconActions,
	) {
		super(app);
		this.pin = structuredClone(pin);
		this.fields = new NameLinkFields(
			app,
			this.pin,
			sourcePath,
			{
				autoTip: T(
					"Nombre automático: el de la nota enlazada (o su encabezado o alias) o, en un portal sin nota, el del marcador destino. Escribir un nombre la desmarca.",
					"Automatic name: the linked note's (or its heading or alias) or, for a portal without a note, the destination marker's. Typing a name unticks it.",
				),
				linkDesc: T(
					"Opcional. Se guarda como wikilink, ej. [[Nota]] o [[Nota#Encabezado]]. Clic en el marcador abre la nota (Ctrl/Cmd+clic: en pestaña nueva).",
					"Optional. Saved as a wikilink, e.g. [[Note]] or [[Note#Heading]]. Clicking the marker opens the note (Ctrl/Cmd+click: in a new tab).",
				),
				autoPlaceholder: T("Enlaza una nota o un marcador destino", "Link a note or a destination marker"),
			},
			() => autoPinName(this.pin, this.data.pins),
		);
	}

	onOpen(): void {
		this.titleEl.setText(this.isNew ? T("Nuevo marcador", "New marker") : T("Editar marcador", "Edit marker"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const p = this.pin;

		// Nombre con casilla AUTO (sale de la nota o del destino del portal) y nota enlazada (se abre con
		// clic principal). El foco, solo la primera vez: el diálogo se redibuja al cambiar el portal.
		this.fields.render(el, this.firstRender);
		this.firstRender = false;

		// Portal / escalera: se usa con clic derecho. Al activarlo, las opciones de
		// destino aparecen en esta misma fila (antes del interruptor).
		const portal = new Setting(el).setName(T("Portal / escalera", "Portal / stairs"));
		if (p.portal) this.addPortalControls(portal);
		else
			portal.setDesc(
				T(
					"Con clic derecho, la cámara viaja a su destino (en el editor, desde el menú; en notas, directamente).",
					"On right-click, the camera travels to its destination (in the editor, from the menu; in notes, directly).",
				),
			);
		portal.addToggle((t) =>
			t.setValue(p.portal).onChange((v) => {
				p.portal = v;
				this.fields.refreshAutoName();
				this.render();
			}),
		);

		this.iconPicker = new IconPicker(el, {
			icon: p.icon ?? "",
			iconColor: p.iconColor,
			background: p.color,
			reload: () => this.iconActions.reload(),
			onChange: (icon) => {
				p.icon = icon;
				this.iconColor?.refresh();
			},
		});

		// Colores del marcador y del icono, lado a lado en una sola fila.
		const colors = new Setting(el).setName(T("Colores", "Colors"));
		colors.controlEl.addClass("strakes-color-row");
		const pinGroup = colors.controlEl.createDiv("strakes-color-group");
		pinGroup.createSpan({ cls: "strakes-color-label", text: T("Marcador", "Marker") });
		new ColorComponent(pinGroup).setValue(p.color).onChange((v) => {
			p.color = v;
			// Los recuadros del selector usan el color del marcador de fondo.
			this.iconPicker?.setBackground(v);
		});
		this.iconColor = new IconColorControl(colors.controlEl.createDiv("strakes-color-group"), {
			label: T("Icono", "Icon"),
			getIcon: () => p.icon ?? "",
			color: p.iconColor,
			defaultColor: DEFAULT_ICON_COLOR,
			onChange: (c) => {
				p.iconColor = c;
				this.iconPicker?.setIconColor(c);
			},
		});

		layerDropdown(this.app, new Setting(el).setName(T("Capa", "Layer")), this.data, this.newLayers, p.layerId, (id) => (p.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("Visible para los jugadores", "Visible to players"))
			.setDesc(T("También tienen que estar visibles para los jugadores su tipo y su capa (iconos de pantalla del panel).", "Its type and layer must also be visible to players (screen icons in the panel)."))
			.addToggle((t) => t.setValue(p.players === true).onChange((on) => (p.players = on || undefined)));

		const buttons = modalFooter(this);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText(T("Eliminar", "Delete"))
					.setDestructive()
					.onClick(() => this.finish("delete")),
			);
		buttons.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("Guardar", "Save"))
				.setCta()
				.onClick(() => this.finish("save")),
		);
	}

	/** Opciones de destino del portal, dentro de la fila «Portal / escalera». */
	private addPortalControls(setting: Setting): void {
		const p = this.pin;
		const others = this.data.pins.filter((o) => o.id !== p.id);
		setting
			.setDesc(
				p.targetPinId
					? T("Destino: el marcador elegido. Se usa con clic derecho.", "Destination: the chosen marker. Used with right-click.")
					: p.target
						? T(
								`Destino: punto fijo (x ${Math.round(p.target.x)}, y ${Math.round(p.target.y)}). Se usa con clic derecho.`,
								`Destination: fixed point (x ${Math.round(p.target.x)}, y ${Math.round(p.target.y)}). Used with right-click.`,
							)
						: T("Elige el destino: otro marcador o un punto del mapa.", "Choose the destination: another marker or a point on the map."),
			)
			.addDropdown((dd) => {
				dd.addOption("", p.target ? T("— Punto fijo —", "— Fixed point —") : T("— Ninguno —", "— None —"));
				for (const o of others) dd.addOption(o.id, o.name || T("(sin nombre)", "(unnamed)"));
				dd.setValue(p.targetPinId ?? "");
				dd.onChange((v) => {
					p.targetPinId = v || undefined;
					this.fields.refreshAutoName();
					this.render();
				});
			})
			.addButton((b) =>
				b
					.setButtonText(T("Elegir en el mapa…", "Pick on the map…"))
					.setTooltip(T("Cierra este diálogo; haz clic en el mapa para fijar el destino con el zoom actual.", "Closes this dialog; click the map to set the destination with the current zoom."))
					.onClick(() => this.finish("pick-target")),
			);
	}

	private finish(action: PinModalResult["action"]): void {
		// Elegir el destino en el mapa con AUTO y sin nombre: el nombre puede salir de ese
		// destino (si no sale, el editor vuelve a abrir el diálogo).
		const nameLater = action === "pick-target" && this.pin.autoName === true;
		if (action !== "delete" && !nameLater && !this.pin.name.trim()) {
			new Notice(
				this.pin.autoName
					? T(
							"AUTO no tiene de dónde tomar el nombre: enlaza una nota o un marcador destino, o escribe un nombre.",
							"AUTO has nowhere to take the name from: link a note or a destination marker, or type a name.",
						)
					: T("Ponle un nombre al marcador", "Give the marker a name"),
			);
			return;
		}
		if (action !== "delete") commitLayers(this.data, this.newLayers);
		this.onDone({ action, pin: this.pin });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- Nombre y nota (zonas y rutas) ----------

/** Lo que necesitan los campos de nombre y nota de un elemento enlazable. */
interface Linkable {
	name: string;
	link?: string;
	autoName?: boolean;
}

/**
 * Campos «Nombre» (con casilla AUTO) y «Nota» (con su encabezado) de un elemento enlazable a una
 * nota: marcadores, zonas y rutas. Con AUTO, el nombre sale de `autoNameOf` (por defecto, del enlace:
 * alias, encabezado o nota; en los marcadores, también del destino de un portal) y escribir un nombre
 * la desmarca.
 */
class NameLinkFields {
	private autoCheck: HTMLInputElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private linkInput: HTMLInputElement | null = null;

	constructor(
		private app: App,
		private item: Linkable,
		private sourcePath: string,
		/** Textos de la casilla AUTO, de la fila «Nota» y de ejemplo del nombre con AUTO (por defecto, «Enlaza una nota»). */
		private texts: { autoTip: string; linkDesc: string; autoPlaceholder?: string },
		private autoNameOf: () => string | null = () => nameFromLink(item.link),
	) {}

	render(el: HTMLElement, focus: boolean): void {
		const item = this.item;
		const nameSetting = new Setting(el).setName(T("Nombre", "Name")).addText((t) => {
			t.setValue(item.name).onChange((v) => {
				item.name = v;
				if (item.autoName) {
					item.autoName = undefined;
					if (this.autoCheck) this.autoCheck.checked = false;
					t.setPlaceholder("");
				}
			});
			this.nameInput = t.inputEl;
			if (focus) window.setTimeout(() => t.inputEl.focus(), 10);
		});
		const autoLabel = nameSetting.controlEl.createEl("label", { cls: "strakes-native-check strakes-auto-name" });
		const autoCheck = autoLabel.createEl("input", { type: "checkbox" });
		autoCheck.checked = item.autoName === true;
		autoLabel.appendText(T("AUTO", "AUTO"));
		autoLabel.setAttribute("aria-label", this.texts.autoTip);
		autoCheck.onchange = () => {
			item.autoName = autoCheck.checked || undefined;
			this.refreshAutoName();
		};
		this.autoCheck = autoCheck;
		this.refreshAutoName();

		let headingHost: HTMLElement;
		new Setting(el)
			.setName(T("Nota", "Note"))
			.setDesc(this.texts.linkDesc)
			.addText((t) => {
				t.setPlaceholder(T("[[Nota]]", "[[Note]]")).setValue(item.link ?? "");
				t.inputEl.addClass("strakes-wide-input");
				this.linkInput = t.inputEl;
				new FileInputSuggest(
					this.app,
					t.inputEl,
					(f) => f.extension === "md" || f.extension === "smap" || f.extension === "canvas",
					(f) => {
						this.setLink(wikilinkFor(this.app, f, this.sourcePath));
						if (!item.autoName && !item.name.trim() && this.nameInput) {
							item.name = f.basename;
							this.nameInput.value = f.basename;
						}
						this.renderHeadings(headingHost);
					},
				);
				t.inputEl.addEventListener("change", () => {
					const v = t.getValue().trim();
					if (!v) this.setLink(undefined);
					else {
						// Acepta "Nota", "[[Nota]]", "Nota#Encabezado"… y lo normaliza.
						const parsed = parseWikilink(v);
						const f = resolveWikilink(this.app, v, this.sourcePath);
						this.setLink(
							f ? wikilinkFor(this.app, f, this.sourcePath, parsed.subpath, parsed.alias) : makeWikilink(parsed.linkpath, parsed.subpath, parsed.alias),
						);
					}
					this.renderHeadings(headingHost);
				});
			});
		headingHost = el.createDiv();
		this.renderHeadings(headingHost);
	}

	private setLink(link: string | undefined): void {
		this.item.link = link;
		if (this.linkInput) this.linkInput.value = link ?? "";
		this.refreshAutoName();
	}

	/**
	 * Con AUTO marcada, pone en el campo el nombre automático (vacío si no hay de dónde sacarlo). El
	 * diálogo del marcador también lo llama al cambiar el portal o su destino.
	 */
	refreshAutoName(): void {
		const item = this.item;
		if (!item.autoName) {
			this.nameInput?.setAttribute("placeholder", "");
			return;
		}
		item.name = this.autoNameOf() ?? "";
		if (this.nameInput) {
			this.nameInput.value = item.name;
			this.nameInput.setAttribute("placeholder", this.texts.autoPlaceholder ?? T("Enlaza una nota", "Link a note"));
		}
	}

	private renderHeadings(host: HTMLElement): void {
		host.empty();
		const item = this.item;
		const file = item.link ? resolveWikilink(this.app, item.link, this.sourcePath) : null;
		if (file && file.extension === "md") {
			const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
			if (headings.length)
				new Setting(host).setName(T("Encabezado (opcional)", "Heading (optional)")).addDropdown((dd) => {
					dd.addOption("", T("— Nota completa —", "— Whole note —"));
					for (const h of headings) dd.addOption(`#${h.heading}`, `${"  ".repeat(h.level - 1)}${h.heading}`);
					dd.setValue(parseWikilink(item.link!).subpath);
					dd.onChange((v) => {
						const cur = parseWikilink(item.link ?? "");
						this.setLink(makeWikilink(cur.linkpath, v, cur.alias));
					});
				});
		} else if (item.link && !file) {
			host.createDiv({ cls: "strakes-warning", text: T("⚠ No se encuentra esa nota.", "⚠ That note can't be found.") });
		}
	}
}

// ---------- Zona ----------

export interface ZoneModalResult {
	action: "save" | "delete";
	zone: MapZone;
}

/**
 * Diálogo de una zona (1.3): nombre con AUTO, nota, colores del relleno y del borde (la
 * transparencia del relleno es un ajuste general), área manual, capa, visibilidad para los jugadores y, con la
 * niebla activada, la casilla «Niebla». El nombre puede quedar vacío
 * (p. ej. una zona que solo sirve para la niebla).
 */
export class ZoneModal extends Modal {
	private zone: MapZone;
	/** Capas creadas en este diálogo; se añaden al mapa solo al guardar. */
	private newLayers: MapLayer[] = [];
	private fields: NameLinkFields;
	private firstRender = true;

	constructor(
		app: App,
		private data: MapData,
		zone: MapZone,
		private isNew: boolean,
		sourcePath: string,
		private onDone: (r: ZoneModalResult) => void,
	) {
		super(app);
		this.zone = structuredClone(zone);
		this.fields = new NameLinkFields(app, this.zone, sourcePath, {
			autoTip: T(
				"Nombre automático: el de la nota enlazada (o su encabezado o alias). Escribir un nombre la desmarca.",
				"Automatic name: the linked note's (or its heading or alias). Typing a name unticks it.",
			),
			linkDesc: T(
				"Opcional. Se guarda como wikilink, ej. [[Nota]] o [[Nota#Encabezado]]. Con la edición bloqueada, clic en la zona abre la nota (Ctrl/Cmd+clic: en pestaña nueva).",
				"Optional. Saved as a wikilink, e.g. [[Note]] or [[Note#Heading]]. With editing locked, clicking the zone opens the note (Ctrl/Cmd+click: in a new tab).",
			),
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.isNew ? T("Nueva zona", "New zone") : T("Editar zona", "Edit zone"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const z = this.zone;
		this.fields.render(el, this.firstRender);
		this.firstRender = false;

		// Colores del relleno y del borde, en una fila.
		const colors = new Setting(el).setName(T("Colores", "Colors"));
		colors.controlEl.addClass("strakes-color-row");
		const fill = colors.controlEl.createDiv("strakes-color-group");
		fill.createSpan({ cls: "strakes-color-label", text: T("Relleno", "Fill") });
		new ColorComponent(fill).setValue(z.color).onChange((v) => (z.color = v));
		const border = colors.controlEl.createDiv("strakes-color-group");
		border.createSpan({ cls: "strakes-color-label", text: T("Borde", "Border") });
		new ColorComponent(border).setValue(z.borderColor).onChange((v) => (z.borderColor = v));

		// Área: la escrita a mano tiene prioridad; vacía, la calculada con la escala.
		const estimate = zoneArea(this.data, { ...z, area: undefined });
		new Setting(el)
			.setName(T(`Área (${this.data.unit || "sin unidad"}²)`, `Area (${this.data.unit || "no unit"}²)`))
			.setDesc(
				this.data.scale
					? T("Vacío = la calculada con la escala del mapa.", "Empty = calculated from the map scale.")
					: T("El mapa no tiene escala: escribe el área real, o déjalo vacío para no mostrarla.", "The map has no scale: enter the real area, or leave it empty to hide it."),
			)
			.addText((t) => {
				decimalInput(t.inputEl);
				t.setPlaceholder(estimate ? `≈ ${fieldNumber(estimate.value)}` : "?");
				t.setValue(z.area === undefined ? "" : fieldNumber(z.area));
				t.onChange((v) => {
					const n = parseDecimal(v);
					z.area = isNaN(n) || n <= 0 ? undefined : n;
				});
			});

		layerDropdown(this.app, new Setting(el).setName(T("Capa", "Layer")), this.data, this.newLayers, z.layerId, (id) => (z.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("Visible para los jugadores", "Visible to players"))
			.setDesc(T("También tienen que estar visibles para los jugadores su tipo y su capa (iconos de pantalla del panel).", "Its type and layer must also be visible to players (screen icons in the panel)."))
			.addToggle((t) => t.setValue(z.players === true).onChange((on) => (z.players = on || undefined)));
		// Niebla (solo si el mapa la tiene activada).
		if (this.data.fog?.enabled)
			new Setting(el)
				.setName(T("Niebla", "Fog"))
				.setDesc(
					T(
						"Marcada, la zona entera queda cubierta y el pincel no la descubre. Sin marcar, la zona no cuenta: se ve lo que diga el pincel. Un clic de pincel sobre la zona también la marca o la desmarca.",
						"Ticked, the whole zone is covered and the brush can't reveal it. Unticked, the zone doesn't count: you see what the brush says. A brush click on the zone also ticks or unticks it.",
					),
				)
				.addToggle((t) => t.setValue(z.fog === true).onChange((on) => (z.fog = on || undefined)));

		const buttons = modalFooter(this);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText(T("Eliminar", "Delete"))
					.setDestructive()
					.onClick(() => this.finish("delete")),
			);
		buttons.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("Guardar", "Save"))
				.setCta()
				.onClick(() => this.finish("save")),
		);
	}

	private finish(action: ZoneModalResult["action"]): void {
		if (action === "save") commitLayers(this.data, this.newLayers);
		this.onDone({ action, zone: this.zone });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- Ruta ----------

export class RouteModal extends Modal {
	private route: MapRoute;
	/** Capas creadas en este diálogo; se añaden al mapa solo al guardar. */
	private newLayers: MapLayer[] = [];
	/** Nombre con AUTO y nota enlazada (1.3), como en las zonas. */
	private fields: NameLinkFields;

	constructor(
		app: App,
		private data: MapData,
		route: MapRoute,
		sourcePath: string,
		private onDone: (r: MapRoute | null, deleted: boolean) => void,
	) {
		super(app);
		this.route = structuredClone(route);
		this.fields = new NameLinkFields(app, this.route, sourcePath, {
			autoTip: T(
				"Nombre automático: el de la nota enlazada (o su encabezado o alias). Escribir un nombre la desmarca.",
				"Automatic name: the linked note's (or its heading or alias). Typing a name unticks it.",
			),
			linkDesc: T(
				"Opcional. Se guarda como wikilink, ej. [[Nota]] o [[Nota#Encabezado]]. Con la edición bloqueada, clic en la ruta abre la nota (Ctrl/Cmd+clic: en pestaña nueva).",
				"Optional. Saved as a wikilink, e.g. [[Note]] or [[Note#Heading]]. With editing locked, clicking the route opens the note (Ctrl/Cmd+click: in a new tab).",
			),
		});
	}

	onOpen(): void {
		this.titleEl.setText(T("Ruta", "Route"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const r = this.route;
		this.fields.render(el, false);
		new Setting(el).setName(T("Color", "Color")).addColorPicker((c) => c.setValue(r.color).onChange((v) => (r.color = v)));
		layerDropdown(this.app, new Setting(el).setName(T("Capa", "Layer")), this.data, this.newLayers, r.layerId, (id) => (r.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("Visible para los jugadores", "Visible to players"))
			.setDesc(T("También tienen que estar visibles para los jugadores su tipo y su capa (iconos de pantalla del panel).", "Its type and layer must also be visible to players (screen icons in the panel)."))
			.addToggle((t) => t.setValue(r.players === true).onChange((on) => (r.players = on || undefined)));
		new Setting(el)
			.setName(T("Curvas suaves", "Smooth curves"))
			.setDesc(T("La línea pasa por los puntos de curva con una curva suave. Desactívalo para usar líneas quebradas.", "The line passes through the curve points with a smooth curve. Turn it off to use straight segments."))
			.addToggle((t) => t.setValue(r.smooth !== false).onChange((v) => (r.smooth = v)));

		el.createEl("h4", { text: T("Tramos", "Segments") });
		el.createDiv({
			cls: "setting-item-description",
			text:
				(this.data.scale
					? T("Distancia: vacío = la estimada por la escala del mapa. ", "Distance: empty = estimated from the map scale. ")
					: T("Distancia: el mapa no tiene escala, escribe la distancia real de cada tramo. ", "Distance: the map has no scale, enter the real distance of each segment. ")) +
				T(
					"Tiempo: horas a paso normal (ej. 6, 6,5 o 6h 30m); vacío = se calcula desde la distancia. Los pasos lento y rápido se ajustan a partir de este tiempo.",
					"Time: hours at normal pace (e.g. 6, 6.5 or 6h 30m); empty = calculated from the distance. Slow and fast paces are adjusted from this time.",
				),
		});
		const nodes = nodeMap(this.data);
		const box = el.createDiv("strakes-seg-list");
		r.times ??= [];
		for (let i = 0; i < r.nodeIds.length - 1; i++) {
			const est = segmentDistance(this.data, { ...r, segments: r.segments.map(() => null) }, i, nodes).value;
			const row = new Setting(box).setName(T(`Tramo ${i + 1}`, `Segment ${i + 1}`));
			row.controlEl.addClass("strakes-seg-inputs");

			row.controlEl.createSpan({ cls: "strakes-seg-input-label", text: this.data.unit || T("dist.", "dist.") });
			row.addText((t) => {
				t.setPlaceholder(est !== null ? `≈ ${fieldNumber(est)}` : "?");
				const manual = r.segments[i];
				t.setValue(manual === null ? "" : fieldNumber(manual));
				decimalInput(t.inputEl);
				t.onChange((v) => {
					const n = parseDecimal(v);
					r.segments[i] = isNaN(n) ? null : n;
				});
			});

			// Placeholder: tiempo estimado desde la distancia (paso normal), si se puede.
			const estTime = segmentTime(this.data, { ...r, times: [] }, i, "normal", nodes).hours;
			row.controlEl.createSpan({ cls: "strakes-seg-input-label", text: "h" });
			row.addText((t) => {
				t.setPlaceholder(estTime !== null ? `≈ ${formatHours(estTime)}` : "?");
				const cur = r.times?.[i];
				t.setValue(typeof cur === "number" ? formatHours(cur) : "");
				t.inputEl.addClass("strakes-seg-time");
				t.onChange((v) => {
					const h = parseHoursInput(v);
					t.inputEl.toggleClass("is-invalid", v.trim() !== "" && h === null);
					r.times![i] = h !== null && h > 0 ? h : null;
				});
			});
		}

		modalFooter(this)
			.addButton((b) =>
				b
					.setButtonText(T("Eliminar ruta", "Delete route"))
					.setDestructive()
					.onClick(() => {
						this.onDone(null, true);
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("Guardar", "Save"))
					.setCta()
					.onClick(() => {
						const negative = this.route.segments.flatMap((d, i) => (d !== null && d < 0 ? [i] : []));
						if (negative.length) warnNegativeDistances(negative);
						commitLayers(this.data, this.newLayers);
						this.onDone(this.route, false);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- Propiedades del mapa ----------

export interface MapProps {
	image: string;
	unit: string;
	scale: number | null;
	/** Niebla de guerra (1.3): activada y su color. */
	fogEnabled: boolean;
	fogColor: string;
}

export class MapPropsModal extends Modal {
	private props: MapProps;

	constructor(
		app: App,
		data: MapData,
		private onSave: (p: MapProps) => void,
		private onCalibrate: () => void,
	) {
		super(app);
		this.props = { image: data.image, unit: data.unit, scale: data.scale, fogEnabled: data.fog?.enabled === true, fogColor: data.fog?.color ?? DEFAULT_FOG_COLOR };
	}

	onOpen(): void {
		this.titleEl.setText(T("Propiedades del mapa", "Map properties"));
		const el = this.contentEl;
		const p = this.props;
		new Setting(el).setName(T("Imagen", "Image")).addText((t) => {
			t.setValue(p.image).onChange((v) => (p.image = v.trim()));
			t.inputEl.addClass("strakes-wide-input");
			// Obsidian enfoca el primer campo al abrir el diálogo: en este, eso abría la lista de imágenes.
			// Se le quita el foco y la lista se conecta después (se abre al hacer clic en él o al escribir).
			const input = t.inputEl;
			window.setTimeout(() => {
				if (input.doc.activeElement === input) input.blur();
				new FileInputSuggest(this.app, input, isImageFile, (f) => (p.image = f.path));
			}, 0);
		});
		// Se crea después (va debajo): al cambiar la unidad, muestra ya la escala convertida.
		let scaleText: TextComponent | null = null;
		const showScale = () => scaleText?.setValue(p.scale === null ? "" : String(Number(p.scale.toPrecision(12))));
		// La escala se convierte siempre desde la de partida (la del archivo, o la última escrita a mano, con
		// su unidad), no de un paso al siguiente: así coincide con `convertMapUnit` al guardar, también al
		// pasar por una unidad que no es de longitud (que solo cambia el nombre).
		let base = { scale: p.scale, unit: p.unit };
		new Setting(el)
			.setName(T("Unidad de distancia", "Distance unit"))
			.setDesc(
				T(
					"Cambiarla conserva el tamaño real: la escala y las distancias y áreas escritas a mano se convierten (5 ft pasan a 1,52 m). Con una unidad que no es de longitud (p. ej. «días»), solo cambia el nombre de la unidad.",
					"Changing it keeps the real size: the scale and the distances and areas entered by hand are converted (5 ft become 1.52 m). With a unit that isn't a length (e.g. \"days\"), only the unit's name changes.",
				),
			)
			.addDropdown((dd) => {
				const options = unitOptions();
				for (const o of options) dd.addOption(o.value, o.label);
				// Una unidad que no está en la lista (mapas antiguos o escritos a mano) se conserva.
				if (p.unit && !options.some((o) => o.value === p.unit)) dd.addOption(p.unit, p.unit);
				dd.setValue(p.unit).onChange((v) => {
					const f = unitFactor(base.unit, v);
					if (base.scale !== null) {
						p.scale = f === null ? base.scale : base.scale * f;
						showScale();
					}
					p.unit = v;
				});
			});
		new Setting(el)
			.setName(T("Escala", "Scale"))
			.setDesc(T("Unidades por píxel de la imagen. Vacío = mapa sin escala (solo distancias manuales por tramo).", "Units per image pixel. Empty = map without scale (only manual distances per segment)."))
			.addText((t) => {
				scaleText = t;
				showScale();
				decimalInput(t.inputEl);
				t.onChange((v) => {
					const n = parseDecimal(v);
					p.scale = isNaN(n) || n <= 0 ? null : n;
					// Escrita a mano: está en la unidad elegida ahora.
					base = { scale: p.scale, unit: p.unit };
				});
			})
			.addButton((b) =>
				// Lo cambiado en el diálogo (imagen, unidad…) se guarda antes de calibrar,
				// para no perderlo al cerrarlo.
				b.setButtonText(T("Calibrar en el mapa…", "Calibrate on the map…")).onClick(() => {
					this.onSave(this.props);
					this.close();
					this.onCalibrate();
				}),
			);
		new Setting(el)
			.setName(T("Niebla de guerra", "Fog of war"))
			.setDesc(
				T(
					"Al activarla por primera vez, el mapa entero empieza cubierto; se descubre con el pincel de niebla de la barra. Para ti se ve semitransparente; para los jugadores, opaca. Desactivarla no borra lo descubierto.",
					"When first turned on, the whole map starts covered; reveal it with the fog brush in the toolbar. You see it semi-transparent; the players see it opaque. Turning it off doesn't erase what was revealed.",
				),
			)
			.addColorPicker((c) => c.setValue(p.fogColor).onChange((v) => (p.fogColor = v)))
			.addToggle((t) => t.setValue(p.fogEnabled).onChange((v) => (p.fogEnabled = v)));
		modalFooter(this)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("Guardar", "Save"))
					.setCta()
					.onClick(() => {
						this.onSave(this.props);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
