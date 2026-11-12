import { App, ColorComponent, Modal, Notice, Setting } from "obsidian";
import { uid } from "../types";
import { FileInputSuggest, isImageFile, promptText } from "../ui/modals";
import { IconColorControl, IconPicker } from "../ui/iconPicker";
import { makeWikilink, parseWikilink, resolveWikilink, wikilinkFor } from "./links";
import { DEFAULT_ICON_COLOR, formatDistance, formatHours, MapData, parseHoursInput, segmentTime, MapPin, MapRoute, nodeMap, segmentDistance } from "./mapData";

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

		modal.titleEl.setText(`Tramo ${i + 1}${route.name.trim() ? ` · ${route.name}` : ""}`);
		const el = modal.contentEl;
		const save = () => {
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
			.setName(`Distancia (${data.unit || "sin unidad"})`)
			.setDesc(data.scale ? "Vacío = la estimada por la escala del mapa." : "El mapa no tiene escala: escribe la distancia real.")
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
			.setName("Tiempo de viaje (paso normal)")
			.setDesc("Horas, ej. 6, 6,5 o 6h 30m. Vacío = se calcula desde la distancia. Los pasos lento y rápido se ajustan a partir de este tiempo.")
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
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => modal.close()))
			.addButton((b) => b.setButtonText("Guardar").setCta().onClick(save));

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
function layerDropdown(
	app: App,
	setting: Setting,
	data: MapData,
	value: string | null,
	onChange: (id: string | null) => void,
	rerender: () => void,
): void {
	setting.addDropdown((dd) => {
		dd.addOption("", "— Sin capa —");
		for (const l of data.layers) dd.addOption(l.id, l.name);
		dd.addOption("__new__", "➕ Nueva capa…");
		dd.setValue(value ?? "");
		dd.onChange(async (v) => {
			if (v !== "__new__") return onChange(v || null);
			const name = await promptText(app, "Nueva capa", { placeholder: "Nombre de la capa" });
			if (name && name.trim()) {
				const layer = { id: uid(), name: name.trim(), visible: true };
				data.layers.push(layer);
				onChange(layer.id);
			}
			rerender();
		});
	});
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
		this.titleEl.setText(this.isNew ? "Nuevo marcador" : "Editar marcador");
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const p = this.pin;

		new Setting(el).setName("Nombre").addText((t) => {
			t.setValue(p.name).onChange((v) => (p.name = v));
			this.nameInput = t.inputEl;
			if (this.firstRender) window.setTimeout(() => t.inputEl.focus(), 10);
		});
		this.firstRender = false;

		// Nota enlazada (opcional): se abre con clic principal.
		this.renderLinkFields(el);

		// Portal / escalera: se usa con clic derecho. Al activarlo, las opciones de
		// destino aparecen en esta misma fila (antes del interruptor).
		const portal = new Setting(el).setName("Portal / escalera");
		if (p.portal) this.addPortalControls(portal);
		else portal.setDesc("Con clic derecho, la cámara viaja a su destino (en el editor, desde el menú; en notas, directamente).");
		portal.addToggle((t) =>
			t.setValue(p.portal).onChange((v) => {
				p.portal = v;
				this.render();
			}),
		);

		this.iconPicker = new IconPicker(el, {
			icon: p.icon ?? "",
			iconColor: p.iconColor,
			background: p.color,
			reload: this.iconActions?.reload,
			onChange: (icon) => {
				p.icon = icon;
				this.iconColor?.refresh();
			},
		});

		// Colores del marcador y del icono, lado a lado en una sola fila.
		const colors = new Setting(el).setName("Colores");
		colors.controlEl.addClass("strakes-color-row");
		const pinGroup = colors.controlEl.createDiv("strakes-color-group");
		pinGroup.createSpan({ cls: "strakes-color-label", text: "Marcador" });
		new ColorComponent(pinGroup).setValue(p.color).onChange((v) => {
			p.color = v;
			// Los recuadros del selector usan el color del marcador de fondo.
			this.iconPicker?.setBackground(v);
		});
		this.iconColor = new IconColorControl(colors.controlEl.createDiv("strakes-color-group"), {
			label: "Icono",
			getIcon: () => p.icon ?? "",
			color: p.iconColor,
			defaultColor: DEFAULT_ICON_COLOR,
			onChange: (c) => {
				p.iconColor = c;
				this.iconPicker?.setIconColor(c);
			},
		});

		layerDropdown(this.app, new Setting(el).setName("Capa"), this.data, p.layerId, (id) => (p.layerId = id), () => this.render());

		const buttons = new Setting(el);
		if (!this.isNew)
			buttons.addButton((b) =>
				b
					.setButtonText("Eliminar")
					.setWarning()
					.onClick(() => this.finish("delete")),
			);
		buttons.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText("Guardar")
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
			.setName("Nota")
			.setDesc("Opcional. Se guarda como wikilink, ej. [[Nota]] o [[Nota#Encabezado]]. Clic en el marcador abre la nota (Ctrl/Cmd+clic: en pestaña nueva).")
			.addText((t) => {
				t.setPlaceholder("[[Nota]]").setValue(p.link ?? "");
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
				new Setting(host).setName("Encabezado (opcional)").addDropdown((dd) => {
					dd.addOption("", "— Nota completa —");
					for (const h of headings) dd.addOption(`#${h.heading}`, `${"\u00a0\u00a0".repeat(h.level - 1)}${h.heading}`);
					dd.setValue(parseWikilink(p.link!).subpath);
					dd.onChange((v) => {
						const cur = parseWikilink(p.link ?? "");
						this.setLink(makeWikilink(cur.linkpath, v, cur.alias));
					});
				});
			}
		} else if (p.link && !file) {
			host.createDiv({ cls: "strakes-warning", text: "⚠ No se encuentra esa nota." });
		}
	}

	/** Opciones de destino del portal, dentro de la fila «Portal / escalera». */
	private addPortalControls(setting: Setting): void {
		const p = this.pin;
		const others = this.data.pins.filter((o) => o.id !== p.id);
		setting
			.setDesc(
				p.targetPinId
					? "Destino: el marcador elegido. Se usa con clic derecho."
					: p.target
						? `Destino: punto fijo (x ${Math.round(p.target.x)}, y ${Math.round(p.target.y)}). Se usa con clic derecho.`
						: "Elige el destino: otro marcador o un punto del mapa.",
			)
			.addDropdown((dd) => {
				dd.addOption("", p.target ? "— Punto fijo —" : "— Ninguno —");
				for (const o of others) dd.addOption(o.id, o.name || "(sin nombre)");
				dd.setValue(p.targetPinId ?? "");
				dd.onChange((v) => {
					p.targetPinId = v || undefined;
					this.render();
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Elegir en el mapa…")
					.setTooltip("Cierra este diálogo; haz clic en el mapa para fijar el destino con el zoom actual.")
					.onClick(() => this.finish("pick-target")),
			);
	}

	private finish(action: PinModalResult["action"]): void {
		if (action !== "delete" && !this.pin.name.trim()) {
			new Notice("Ponle un nombre al marcador");
			return;
		}
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
		this.titleEl.setText("Ruta");
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const r = this.route;
		new Setting(el).setName("Nombre").addText((t) => t.setValue(r.name).onChange((v) => (r.name = v)));
		new Setting(el).setName("Color").addColorPicker((c) => c.setValue(r.color).onChange((v) => (r.color = v)));
		layerDropdown(this.app, new Setting(el).setName("Capa"), this.data, r.layerId, (id) => (r.layerId = id), () => this.render());
		new Setting(el)
			.setName("Curvas suaves")
			.setDesc("La línea pasa por los puntos de curva con una curva suave. Desactívalo para usar líneas quebradas.")
			.addToggle((t) => t.setValue(r.smooth !== false).onChange((v) => (r.smooth = v)));

		el.createEl("h4", { text: "Tramos" });
		el.createDiv({
			cls: "setting-item-description",
			text:
				(this.data.scale
					? "Distancia: vacío = la estimada por la escala del mapa. "
					: "Distancia: el mapa no tiene escala, escribe la distancia real de cada tramo. ") +
				"Tiempo: horas a paso normal (ej. 6, 6,5 o 6h 30m); vacío = se calcula desde la distancia. " +
				"Los pasos lento y rápido se ajustan a partir de este tiempo.",
		});
		const nodes = nodeMap(this.data);
		const box = el.createDiv("strakes-seg-list");
		r.times ??= [];
		for (let i = 0; i < r.nodeIds.length - 1; i++) {
			const est = this.data.scale ? segmentDistance(this.data, { ...r, segments: r.segments.map(() => null) }, i, nodes).value : null;
			const row = new Setting(box).setName(`Tramo ${i + 1}`);
			row.controlEl.addClass("strakes-seg-inputs");

			row.controlEl.createSpan({ cls: "strakes-seg-input-label", text: this.data.unit || "dist." });
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
					.setButtonText("Eliminar ruta")
					.setWarning()
					.onClick(() => {
						this.onDone(null, true);
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Guardar")
					.setCta()
					.onClick(() => {
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
		this.titleEl.setText("Propiedades del mapa");
		const el = this.contentEl;
		const p = this.props;
		new Setting(el).setName("Imagen").addText((t) => {
			t.setValue(p.image).onChange((v) => (p.image = v.trim()));
			t.inputEl.addClass("strakes-wide-input");
			new FileInputSuggest(this.app, t.inputEl, isImageFile, (f) => (p.image = f.path));
		});
		new Setting(el)
			.setName("Unidad de distancia")
			.setDesc("km, millas, leguas, días de viaje…")
			.addText((t) => t.setValue(p.unit).onChange((v) => (p.unit = v.trim())));
		new Setting(el)
			.setName("Escala")
			.setDesc("Unidades por píxel de la imagen. Vacío = mapa sin escala (solo distancias manuales por tramo).")
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
				b.setButtonText("Calibrar en el mapa…").onClick(() => {
					this.close();
					this.onCalibrate();
				}),
			);
		new Setting(el)
			.setName("Mostrar etiquetas de los tramos")
			.addToggle((t) => t.setValue(p.showDistances).onChange((v) => (p.showDistances = v)));
		new Setting(el)
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Guardar")
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
