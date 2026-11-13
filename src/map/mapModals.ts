import { App, ColorComponent, Modal, Notice, Setting } from "obsidian";
import { T } from "../i18n";
import { uid } from "../types";
import { FileInputSuggest, isImageFile, promptText } from "../ui/modals";
import { IconColorControl, IconPicker } from "../ui/iconPicker";
import { makeWikilink, parseWikilink, resolveWikilink, wikilinkFor } from "./links";
import { DEFAULT_ICON_COLOR, formatDistance, formatHours, MapData, MapLayer, parseHoursInput, segmentTime, MapPin, MapRoute, nodeMap, segmentDistance } from "./mapData";

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
		const estDist = data.scale ? segmentDistance(data, { ...route, segments: route.segments.map(() => null) }, i, nodes).value : null;
		const estTime = segmentTime(data, { ...route, segments: [...route.segments], times: [] }, i, "normal", nodes).hours;

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
				t.inputEl.type = "number";
				t.inputEl.step = "any";
				t.setPlaceholder(estDist !== null ? `≈ ${formatDistance(estDist, "")}` : "?");
				t.setValue(result.distance === null ? "" : String(result.distance));
				t.onChange((v) => {
					const n = parseFloat(v.replace(",", "."));
					result.distance = v.trim() === "" || isNaN(n) ? null : n;
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

/** Desplegable de capa: «Sin capa», las capas del usuario y la opción de crear una nueva. */
/**
 * Desplegable de capa de los diálogos de marcador y ruta. Las capas creadas aquí van a
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

export class PinModal extends Modal {
	private pin: MapPin;
	/** Capas creadas en este diálogo; se añaden al mapa solo al guardar. */
	private newLayers: MapLayer[] = [];
	private nameInput: HTMLInputElement | null = null;
	private linkInput: HTMLInputElement | null = null;
	private firstRender = true;
	private iconPicker: IconPicker | null = null;
	private iconColor: IconColorControl | null = null;

	constructor(
		app: App,
		private data: MapData,
		pin: MapPin,
		private isNew: boolean,
		private sourcePath: string,
		private onDone: (r: PinModalResult) => void,
		private iconActions?: PinIconActions,
	) {
		super(app);
		this.pin = structuredClone(pin);
	}

	onOpen(): void {
		this.titleEl.setText(this.isNew ? T("Nuevo marcador", "New marker") : T("Editar marcador", "Edit marker"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const p = this.pin;

		new Setting(el).setName(T("Nombre", "Name")).addText((t) => {
			t.setValue(p.name).onChange((v) => (p.name = v));
			this.nameInput = t.inputEl;
			if (this.firstRender) window.setTimeout(() => t.inputEl.focus(), 10);
		});
		this.firstRender = false;

		// Nota enlazada (opcional): se abre con clic principal.
		this.renderLinkFields(el);

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
				this.render();
			}),
		);

		const actions = this.iconActions;
		this.iconPicker = new IconPicker(el, {
			icon: p.icon ?? "",
			iconColor: p.iconColor,
			background: p.color,
			reload: actions ? () => actions.reload() : undefined,
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

		const buttons = new Setting(el);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText(T("Eliminar", "Delete"))
					.setWarning()
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

	private renderLinkFields(el: HTMLElement): void {
		const p = this.pin;
		// Los encabezados se pintan en su propio contenedor para no reconstruir
		// todo el diálogo (eso haría perder el clic en «Guardar» tras escribir).
		let headingHost: HTMLElement;
		new Setting(el)
			.setName(T("Nota", "Note"))
			.setDesc(
				T(
					"Opcional. Se guarda como wikilink, ej. [[Nota]] o [[Nota#Encabezado]]. Clic en el marcador abre la nota (Ctrl/Cmd+clic: en pestaña nueva).",
					"Optional. Saved as a wikilink, e.g. [[Note]] or [[Note#Heading]]. Clicking the marker opens the note (Ctrl/Cmd+click: in a new tab).",
				),
			)
			.addText((t) => {
				t.setPlaceholder(T("[[Nota]]", "[[Note]]")).setValue(p.link ?? "");
				t.inputEl.addClass("strakes-wide-input");
				this.linkInput = t.inputEl;
				new FileInputSuggest(
					this.app,
					t.inputEl,
					(f) => f.extension === "md" || f.extension === "smap" || f.extension === "canvas",
					(f) => {
						this.setLink(wikilinkFor(this.app, f, this.sourcePath));
						if (!p.name.trim() && this.nameInput) {
							p.name = f.basename;
							this.nameInput.value = f.basename;
						}
						this.renderHeadings(headingHost);
					},
				);
				t.inputEl.addEventListener("change", () => {
					const v = t.getValue().trim();
					if (!v) {
						this.setLink(undefined);
					} else {
						// Acepta "Nota", "[[Nota]]", "Nota#Encabezado"… y lo normaliza.
						const parsed = parseWikilink(v);
						const f = resolveWikilink(this.app, v, this.sourcePath);
						this.setLink(
							f
								? wikilinkFor(this.app, f, this.sourcePath, parsed.subpath, parsed.alias)
								: makeWikilink(parsed.linkpath, parsed.subpath, parsed.alias),
						);
					}
					this.renderHeadings(headingHost);
				});
			});
		headingHost = el.createDiv();
		this.renderHeadings(headingHost);
	}

	private setLink(link: string | undefined): void {
		this.pin.link = link;
		if (this.linkInput) this.linkInput.value = link ?? "";
	}

	private renderHeadings(host: HTMLElement): void {
		host.empty();
		const p = this.pin;
		const file = p.link ? resolveWikilink(this.app, p.link, this.sourcePath) : null;
		if (file && file.extension === "md") {
			const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
			if (headings.length) {
				new Setting(host).setName(T("Encabezado (opcional)", "Heading (optional)")).addDropdown((dd) => {
					dd.addOption("", T("— Nota completa —", "— Whole note —"));
					for (const h of headings) dd.addOption(`#${h.heading}`, `${"\u00a0\u00a0".repeat(h.level - 1)}${h.heading}`);
					dd.setValue(parseWikilink(p.link!).subpath);
					dd.onChange((v) => {
						const cur = parseWikilink(p.link ?? "");
						this.setLink(makeWikilink(cur.linkpath, v, cur.alias));
					});
				});
			}
		} else if (p.link && !file) {
			host.createDiv({ cls: "strakes-warning", text: T("⚠ No se encuentra esa nota.", "⚠ That note can't be found.") });
		}
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
		if (action !== "delete" && !this.pin.name.trim()) {
			new Notice(T("Ponle un nombre al marcador", "Give the marker a name"));
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

// ---------- Ruta ----------

export class RouteModal extends Modal {
	private route: MapRoute;
	/** Capas creadas en este diálogo; se añaden al mapa solo al guardar. */
	private newLayers: MapLayer[] = [];

	constructor(
		app: App,
		private data: MapData,
		route: MapRoute,
		private onDone: (r: MapRoute | null, deleted: boolean) => void,
	) {
		super(app);
		this.route = structuredClone(route);
	}

	onOpen(): void {
		this.titleEl.setText(T("Ruta", "Route"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const r = this.route;
		new Setting(el).setName(T("Nombre", "Name")).addText((t) => t.setValue(r.name).onChange((v) => (r.name = v)));
		new Setting(el).setName(T("Color", "Color")).addColorPicker((c) => c.setValue(r.color).onChange((v) => (r.color = v)));
		layerDropdown(this.app, new Setting(el).setName(T("Capa", "Layer")), this.data, this.newLayers, r.layerId, (id) => (r.layerId = id), () => this.render());
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
			const est = this.data.scale ? segmentDistance(this.data, { ...r, segments: r.segments.map(() => null) }, i, nodes).value : null;
			const row = new Setting(box).setName(T(`Tramo ${i + 1}`, `Segment ${i + 1}`));
			row.controlEl.addClass("strakes-seg-inputs");

			row.controlEl.createSpan({ cls: "strakes-seg-input-label", text: this.data.unit || T("dist.", "dist.") });
			row.addText((t) => {
				t.setPlaceholder(est !== null ? `≈ ${formatDistance(est, "")}` : "?");
				t.setValue(r.segments[i] === null ? "" : String(r.segments[i]));
				t.inputEl.type = "number";
				t.inputEl.step = "any";
				t.onChange((v) => {
					const n = parseFloat(v.replace(",", "."));
					r.segments[i] = v.trim() === "" || isNaN(n) ? null : n;
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

		new Setting(el)
			.addButton((b) =>
				b
					.setButtonText(T("Eliminar ruta", "Delete route"))
					.setWarning()
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
	showDistances: boolean;
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
		this.props = { image: data.image, unit: data.unit, scale: data.scale, showDistances: data.showDistances };
	}

	onOpen(): void {
		this.titleEl.setText(T("Propiedades del mapa", "Map properties"));
		const el = this.contentEl;
		const p = this.props;
		new Setting(el).setName(T("Imagen", "Image")).addText((t) => {
			t.setValue(p.image).onChange((v) => (p.image = v.trim()));
			t.inputEl.addClass("strakes-wide-input");
			new FileInputSuggest(this.app, t.inputEl, isImageFile, (f) => (p.image = f.path));
		});
		new Setting(el)
			.setName(T("Unidad de distancia", "Distance unit"))
			.setDesc(T("km, millas, leguas, días de viaje…", "km, miles, leagues, days of travel…"))
			.addText((t) => t.setValue(p.unit).onChange((v) => (p.unit = v.trim())));
		new Setting(el)
			.setName(T("Escala", "Scale"))
			.setDesc(T("Unidades por píxel de la imagen. Vacío = mapa sin escala (solo distancias manuales por tramo).", "Units per image pixel. Empty = map without scale (only manual distances per segment)."))
			.addText((t) => {
				t.setValue(p.scale === null ? "" : String(p.scale));
				t.inputEl.type = "number";
				t.inputEl.step = "any";
				t.onChange((v) => {
					const n = parseFloat(v);
					p.scale = !v.trim() || isNaN(n) || n <= 0 ? null : n;
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
			.setName(T("Mostrar etiquetas de los tramos", "Show segment labels"))
			.addToggle((t) => t.setValue(p.showDistances).onChange((v) => (p.showDistances = v)));
		new Setting(el)
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
