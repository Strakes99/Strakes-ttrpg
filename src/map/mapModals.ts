import { App, ColorComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { T } from "../i18n";
import { uid } from "../types";
import { FileInputSuggest, isImageFile, modalFooter, promptText } from "../ui/modals";
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
		modal.titleEl.setText(T("mapModals.segment", { i: i + 1, routeName }));
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
			.setName(T("mapModals.segmentDistanceUnit", { unit: data.unit || T("mapModals.noUnit") }))
			.setDesc(
				data.scale
					? T("mapModals.emptyEstimatedFromTheMap")
					: T("mapModals.theMapHasNoScale"),
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
			.setName(T("mapModals.travelTimeNormalPace"))
			.setDesc(
				T("mapModals.hoursEG66"),
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
			.addButton((b) => b.setButtonText(T("mapModals.cancel")).onClick(() => modal.close()))
			.addButton((b) => b.setButtonText(T("mapModals.save")).setCta().onClick(save));

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
		dd.addOption("", T("mapModals.noLayer"));
		for (const l of [...data.layers, ...pending]) dd.addOption(l.id, l.name);
		dd.addOption("__new__", T("mapModals.newLayer"));
		dd.setValue(value ?? "");
		dd.onChange(async (v) => {
			if (v !== "__new__") return onChange(v || null);
			const name = await promptText(app, T("mapModals.newLayer2"), { placeholder: T("mapModals.layerName") });
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
	new Notice(T("mapModals.negativeDistance", { list, count: segments.length }), 8000);
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
				autoTip: T("mapModals.automaticNameTheLinkedNotes"),
				linkDesc: T("mapModals.optionalSavedAsAWikilink"),
				autoPlaceholder: T("mapModals.linkANoteOrA"),
			},
			() => autoPinName(this.pin, this.data.pins),
		);
	}

	onOpen(): void {
		this.titleEl.setText(this.isNew ? T("mapModals.newMarker") : T("mapModals.editMarker"));
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
		const portal = new Setting(el).setName(T("mapModals.portalStairs"));
		if (p.portal) this.addPortalControls(portal);
		else
			portal.setDesc(
				T("mapModals.onRightClickTheCamera"),
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
		const colors = new Setting(el).setName(T("mapModals.colors"));
		colors.controlEl.addClass("strakes-color-row");
		const pinGroup = colors.controlEl.createDiv("strakes-color-group");
		pinGroup.createSpan({ cls: "strakes-color-label", text: T("mapModals.marker") });
		new ColorComponent(pinGroup).setValue(p.color).onChange((v) => {
			p.color = v;
			// Los recuadros del selector usan el color del marcador de fondo.
			this.iconPicker?.setBackground(v);
		});
		this.iconColor = new IconColorControl(colors.controlEl.createDiv("strakes-color-group"), {
			label: T("mapModals.icon"),
			getIcon: () => p.icon ?? "",
			color: p.iconColor,
			defaultColor: DEFAULT_ICON_COLOR,
			onChange: (c) => {
				p.iconColor = c;
				this.iconPicker?.setIconColor(c);
			},
		});

		layerDropdown(this.app, new Setting(el).setName(T("mapModals.layer")), this.data, this.newLayers, p.layerId, (id) => (p.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("mapModals.visibleToPlayers"))
			.setDesc(T("mapModals.itsTypeAndLayerMust"))
			.addToggle((t) => t.setValue(p.players === true).onChange((on) => (p.players = on || undefined)));

		const buttons = modalFooter(this);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText(T("mapModals.delete"))
					.setDestructive()
					.onClick(() => this.finish("delete")),
			);
		buttons.addButton((b) => b.setButtonText(T("mapModals.cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("mapModals.save"))
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
					? T("mapModals.destinationTheChosenMarkerUsed")
					: p.target
						? T("mapModals.destinationFixedPointXY", { x: Math.round(p.target.x), y: Math.round(p.target.y) })
						: T("mapModals.chooseTheDestinationAnotherMarker"),
			)
			.addDropdown((dd) => {
				dd.addOption("", p.target ? T("mapModals.fixedPoint") : T("mapModals.none"));
				for (const o of others) dd.addOption(o.id, o.name || T("mapModals.unnamed"));
				dd.setValue(p.targetPinId ?? "");
				dd.onChange((v) => {
					p.targetPinId = v || undefined;
					this.fields.refreshAutoName();
					this.render();
				});
			})
			.addButton((b) =>
				b
					.setButtonText(T("mapModals.pickOnTheMap"))
					.setTooltip(T("mapModals.closesThisDialogClickThe"))
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
					? T("mapModals.autoHasNowhereToTake")
					: T("mapModals.giveTheMarkerAName"),
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
		const nameSetting = new Setting(el).setName(T("mapModals.name")).addText((t) => {
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
		autoLabel.appendText(T("mapModals.auto"));
		autoLabel.setAttribute("aria-label", this.texts.autoTip);
		autoCheck.onchange = () => {
			item.autoName = autoCheck.checked || undefined;
			this.refreshAutoName();
		};
		this.autoCheck = autoCheck;
		this.refreshAutoName();

		let headingHost: HTMLElement;
		new Setting(el)
			.setName(T("mapModals.note"))
			.setDesc(this.texts.linkDesc)
			.addText((t) => {
				t.setPlaceholder(T("mapModals.note2")).setValue(item.link ?? "");
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
			this.nameInput.setAttribute("placeholder", this.texts.autoPlaceholder ?? T("mapModals.linkANote"));
		}
	}

	private renderHeadings(host: HTMLElement): void {
		host.empty();
		const item = this.item;
		const file = item.link ? resolveWikilink(this.app, item.link, this.sourcePath) : null;
		if (file && file.extension === "md") {
			const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
			if (headings.length)
				new Setting(host).setName(T("mapModals.headingOptional")).addDropdown((dd) => {
					dd.addOption("", T("mapModals.wholeNote"));
					for (const h of headings) dd.addOption(`#${h.heading}`, `${"  ".repeat(h.level - 1)}${h.heading}`);
					dd.setValue(parseWikilink(item.link!).subpath);
					dd.onChange((v) => {
						const cur = parseWikilink(item.link ?? "");
						this.setLink(makeWikilink(cur.linkpath, v, cur.alias));
					});
				});
		} else if (item.link && !file) {
			host.createDiv({ cls: "strakes-warning", text: T("mapModals.thatNoteCantBeFound") });
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
			autoTip: T("mapModals.automaticNameTheLinkedNotes2"),
			linkDesc: T("mapModals.optionalSavedAsAWikilink2"),
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.isNew ? T("mapModals.newZone") : T("mapModals.editZone"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const z = this.zone;
		this.fields.render(el, this.firstRender);
		this.firstRender = false;

		// Colores del relleno y del borde, en una fila.
		const colors = new Setting(el).setName(T("mapModals.colors"));
		colors.controlEl.addClass("strakes-color-row");
		const fill = colors.controlEl.createDiv("strakes-color-group");
		fill.createSpan({ cls: "strakes-color-label", text: T("mapModals.fill") });
		new ColorComponent(fill).setValue(z.color).onChange((v) => (z.color = v));
		const border = colors.controlEl.createDiv("strakes-color-group");
		border.createSpan({ cls: "strakes-color-label", text: T("mapModals.border") });
		new ColorComponent(border).setValue(z.borderColor).onChange((v) => (z.borderColor = v));

		// Área: la escrita a mano tiene prioridad; vacía, la calculada con la escala.
		const estimate = zoneArea(this.data, { ...z, area: undefined });
		new Setting(el)
			.setName(T("mapModals.zoneAreaUnit", { unit: this.data.unit || T("mapModals.noUnit") }))
			.setDesc(
				this.data.scale
					? T("mapModals.emptyCalculatedFromTheMap")
					: T("mapModals.theMapHasNoScale2"),
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

		layerDropdown(this.app, new Setting(el).setName(T("mapModals.layer")), this.data, this.newLayers, z.layerId, (id) => (z.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("mapModals.visibleToPlayers"))
			.setDesc(T("mapModals.itsTypeAndLayerMust"))
			.addToggle((t) => t.setValue(z.players === true).onChange((on) => (z.players = on || undefined)));
		// Niebla (solo si el mapa la tiene activada).
		if (this.data.fog?.enabled)
			new Setting(el)
				.setName(T("mapModals.fog"))
				.setDesc(
					T("mapModals.tickedTheWholeZoneIs"),
				)
				.addToggle((t) => t.setValue(z.fog === true).onChange((on) => (z.fog = on || undefined)));

		const buttons = modalFooter(this);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText(T("mapModals.delete"))
					.setDestructive()
					.onClick(() => this.finish("delete")),
			);
		buttons.addButton((b) => b.setButtonText(T("mapModals.cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("mapModals.save"))
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
			autoTip: T("mapModals.automaticNameTheLinkedNotes2"),
			linkDesc: T("mapModals.optionalSavedAsAWikilink3"),
		});
	}

	onOpen(): void {
		this.titleEl.setText(T("mapModals.route"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const r = this.route;
		this.fields.render(el, false);
		new Setting(el).setName(T("mapModals.color")).addColorPicker((c) => c.setValue(r.color).onChange((v) => (r.color = v)));
		layerDropdown(this.app, new Setting(el).setName(T("mapModals.layer")), this.data, this.newLayers, r.layerId, (id) => (r.layerId = id), () => this.render());
		new Setting(el)
			.setName(T("mapModals.visibleToPlayers"))
			.setDesc(T("mapModals.itsTypeAndLayerMust"))
			.addToggle((t) => t.setValue(r.players === true).onChange((on) => (r.players = on || undefined)));
		new Setting(el)
			.setName(T("mapModals.smoothCurves"))
			.setDesc(T("mapModals.theLinePassesThroughThe"))
			.addToggle((t) => t.setValue(r.smooth !== false).onChange((v) => (r.smooth = v)));

		el.createEl("h4", { text: T("mapModals.segments") });
		el.createDiv({
			cls: "setting-item-description",
			text:
				(this.data.scale
					? T("mapModals.distanceEmptyEstimatedFromThe")
					: T("mapModals.distanceTheMapHasNo")) +
				T("mapModals.timeHoursAtNormalPace"),
		});
		const nodes = nodeMap(this.data);
		const box = el.createDiv("strakes-seg-list");
		r.times ??= [];
		for (let i = 0; i < r.nodeIds.length - 1; i++) {
			const est = segmentDistance(this.data, { ...r, segments: r.segments.map(() => null) }, i, nodes).value;
			const row = new Setting(box).setName(T("mapModals.segment2", { i: i + 1 }));
			row.controlEl.addClass("strakes-seg-inputs");

			row.controlEl.createSpan({ cls: "strakes-seg-input-label", text: this.data.unit || T("mapModals.dist") });
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
					.setButtonText(T("mapModals.deleteRoute"))
					.setDestructive()
					.onClick(() => {
						this.onDone(null, true);
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText(T("mapModals.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("mapModals.save"))
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
		this.titleEl.setText(T("mapModals.mapProperties"));
		const el = this.contentEl;
		const p = this.props;
		new Setting(el).setName(T("mapModals.image")).addText((t) => {
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
			.setName(T("mapModals.distanceUnit"))
			.setDesc(
				T("mapModals.changingItKeepsTheReal"),
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
			.setName(T("mapModals.scale"))
			.setDesc(T("mapModals.unitsPerImagePixelEmpty"))
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
				b.setButtonText(T("mapModals.calibrateOnTheMap")).onClick(() => {
					this.onSave(this.props);
					this.close();
					this.onCalibrate();
				}),
			);
		new Setting(el)
			.setName(T("mapModals.fogOfWar"))
			.setDesc(
				T("mapModals.whenFirstTurnedOnThe"),
			)
			.addColorPicker((c) => c.setValue(p.fogColor).onChange((v) => (p.fogColor = v)))
			.addToggle((t) => t.setValue(p.fogEnabled).onChange((v) => (p.fogEnabled = v)));
		modalFooter(this)
			.addButton((b) => b.setButtonText(T("mapModals.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("mapModals.save"))
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
