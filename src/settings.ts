import { App, PluginSettingTab, Setting, SettingDefinitionItem, setIcon, setTooltip } from "obsidian";
import { T } from "./i18n";
import type StrakesTTRPG from "./main";
import { ConditionModal, renderConditionIcon } from "./initiative/conditionUi";
import { allConditions, CC_BY_URL, customInfo, SRD_URL } from "./initiative/conditions";
import { confirmDialog } from "./ui/modals";
import { decimalInput, parseDecimal } from "./ui/dom";
import { unitOptions } from "./map/mapData";
import { StrakesSettings } from "./types";

/** Primera línea con texto de una descripción en Markdown, sin marcas de formato (para la lista). */
function firstLine(markdown: string): string {
	const line = markdown.split("\n").find((l) => l.trim()) ?? "";
	return line.replace(/^#+\s*/, "").replace(/\*\*|__|\*|`/g, "").trim();
}

/**
 * Pestaña de ajustes con la API declarativa de Obsidian 1.13 (`getSettingDefinitions`):
 * Obsidian dibuja los controles, los incluye en su buscador de ajustes y lee y escribe los
 * valores con `getControlValue` / `setControlValue`. Las partes a medida (cuadrícula de
 * condiciones, condiciones personalizadas, iconos SVG) usan `render`. Para volver a
 * dibujar la pestaña tras un cambio de estructura se llama a `this.update()`.
 */
export class StrakesSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: StrakesTTRPG,
	) {
		super(app, plugin);
	}

	/**
	 * Guarda cada cambio de un control y avisa a las vistas abiertas (pantalla de jugadores,
	 * iniciativa, mapas) para que se actualicen al momento.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "mapFolder" && typeof value === "string") value = value.trim().replace(/\/+$/, "");
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.save();
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.events.trigger("settings");
	}

	getSettingDefinitions(): SettingDefinitionItem<Extract<keyof StrakesSettings, string>>[] {
		/** Número entero en píxeles dentro de un rango; fuera de él, Obsidian muestra el error y no lo guarda. */
		const px = (min: number, max: number) => ({
			type: "number" as const,
			min,
			max,
			step: 1,
			validate: (v: number) =>
				!Number.isInteger(v) || v < min || v > max ? T(`Un número entero entre ${min} y ${max}.`, `A whole number between ${min} and ${max}.`) : undefined,
		});
		return [
			{
				type: "group",
				heading: T("Pantalla de jugadores", "Player screen"),
				items: [
					{ name: T("Color de fondo", "Background color"), control: { type: "color", key: "playerBackground" } },
					{
						name: T("Tamaño de letra", "Font size"),
						desc: T("Tamaño base del texto de las notas enviadas (px).", "Base text size of the notes you send (px)."),
						control: { type: "slider", key: "playerFontSize", min: 12, max: 48, step: 1 },
					},
				],
			},
			{
				type: "group",
				heading: T("Iniciativa", "Initiative"),
				items: [
					{
						name: T("Tamaño de las tarjetas", "Card size"),
						desc: T(
							"Modo Tarjetas: ancho y alto del retrato, en píxeles. Las tarjetas que no caben en una fila pasan a la siguiente; el retrato solo se reduce si no caben en la ventana.",
							"Cards mode: width and height of the portrait, in pixels. Cards that don't fit in a row wrap to the next one; the portrait only shrinks if they don't fit in the window.",
						),
						control: { key: "cardSize", ...px(60, 800) },
					},
					{
						name: T("Separación entre tarjetas", "Card spacing"),
						desc: T("Modo Tarjetas: espacio entre tarjetas, en píxeles.", "Cards mode: space between cards, in pixels."),
						control: { key: "cardGap", ...px(0, 200) },
					},
					{
						name: T("Tamaño del texto", "Text size"),
						desc: T(
							"Texto de la iniciativa en la pantalla de jugadores (Lista y nombres y PG de las Tarjetas), en píxeles. Se respeta siempre: para que todo quepa se reparten columnas o se reducen los retratos, nunca el texto.",
							"Initiative text on the player screen (List, and names and HP on Cards), in pixels. It is always respected: to make everything fit, the list splits into columns or portraits shrink, never the text.",
						),
						control: { key: "initiativeTextSize", ...px(8, 96) },
					},
					{
						name: T("Posición de la lista", "List position"),
						control: {
							type: "dropdown",
							key: "overlayPosition",
							options: {
								"top-left": T("Arriba a la izquierda", "Top left"),
								"top-right": T("Arriba a la derecha", "Top right"),
								"bottom-left": T("Abajo a la izquierda", "Bottom left"),
								"bottom-right": T("Abajo a la derecha", "Bottom right"),
							},
						},
					},
					{
						name: T("Mostrar PG de los PJ y aliados", "Show HP of PCs and allies"),
						desc: T("Los jugadores ven los puntos de golpe de sus personajes y de los aliados.", "Players see the hit points of their characters and of allies."),
						control: { type: "toggle", key: "showPlayerHp" },
					},
					{
						name: T("Mostrar PG de los enemigos", "Show HP of enemies"),
						desc: T("Los jugadores ven los puntos de golpe de los enemigos visibles.", "Players see the hit points of visible enemies."),
						control: { type: "toggle", key: "showNpcHp" },
					},
					{
						name: T("Condiciones de las reglas básicas", "Basic rules conditions"),
						desc: T(
							"Haz clic en una para editarla por completo (nombre, descripción, icono, color, condiciones que aplica, niveles y automatismos) u ocultarla. Las modificadas se marcan con un punto y las ocultas se ven atenuadas.",
							"Click one to fully edit it (name, description, icon, color, conditions it applies, levels and automations) or hide it. Modified ones are marked with a dot and hidden ones are dimmed.",
						),
						render: (setting) => this.renderBuiltinConditions(setting),
					},
					{
						name: T("Condiciones personalizadas", "Custom conditions"),
						desc: T(
							"Se añaden a la lista del tracker, con su propio icono y color (sin fondo). Pueden aplicar otras condiciones y ser acumulativas.",
							"They are added to the tracker's list, with their own icon and color (no background). They can apply other conditions and be cumulative.",
						),
						render: (setting) => {
							setting.addButton((b) =>
								b
									.setButtonText(T("Nueva condición…", "New condition…"))
									.setCta()
									.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond: null }).open()),
							);
						},
					},
				],
			},
			// Una fila por condición personalizada: editar con el lápiz, eliminar con la papelera de la lista.
			{
				type: "list",
				visible: () => this.plugin.settings.customConditions.length > 0,
				onDelete: (index) => void this.deleteCustomCondition(index),
				items: this.plugin.settings.customConditions.map((cond) => ({
					name: cond.name,
					desc: firstLine(cond.description),
					render: (setting: Setting) => {
						setting.settingEl.addClass("strakes-custom-cond-row");
						// La fila puede reutilizarse en update(): sin duplicar el icono.
						setting.nameEl.querySelector(".strakes-custom-cond-icon")?.remove();
						const iconEl = createSpan({ cls: "strakes-custom-cond-icon" });
						renderConditionIcon(iconEl, customInfo(cond));
						setting.nameEl.prepend(iconEl);
						setting.addExtraButton((b) =>
							b
								.setIcon("pencil")
								.setTooltip(T("Editar", "Edit"))
								.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond }).open()),
						);
					},
				})),
			},
			{
				type: "group",
				heading: T("Mapas", "Maps"),
				items: [
					{
						name: T("Unidad de los mapas nuevos", "Unit for new maps"),
						desc: T(
							"Los mapas nuevos se crean con esta unidad. Cada mapa se ve siempre en su propia unidad; para cambiarla, usa el selector de unidad de la barra del mapa o sus propiedades.",
							"New maps are created with this unit. Each map is always shown in its own unit; to change it, use the unit selector in the map toolbar or its properties.",
						),
						control: {
							type: "dropdown",
							key: "displayUnit",
							options: Object.fromEntries(unitOptions().map((o) => [o.value, o.label])),
						},
					},
					{
						name: T("Título en la vista previa de los marcadores", "Title in marker previews"),
						desc: T(
							"Muestra el nombre de la nota encima de la vista previa al pasar el cursor con Ctrl sobre un marcador enlazado a una nota completa (no a un encabezado).",
							"Shows the note name above the preview when you Ctrl+hover a marker linked to a whole note (not to a heading).",
						),
						control: { type: "toggle", key: "pinPreviewTitle" },
					},
					{
						name: T("Bloquear los mapas incrustados", "Lock embedded maps"),
						desc: T(
							"Bloquea el zoom y el arrastre de todos los mapas incrustados en notas (la rueda desplaza la nota) y oculta su candado. Los clics en los marcadores siguen funcionando.",
							"Locks zoom and dragging on every map embedded in a note (the wheel scrolls the note) and hides its lock button. Clicking markers still works.",
						),
						control: { type: "toggle", key: "lockAllEmbeds" },
					},
					{
						name: T("Incremento del zoom", "Zoom step"),
						desc: T(
							"Cuánto acerca o aleja cada paso de la rueda del ratón en los mapas (editor e incrustados), en niveles de zoom. Un nivel duplica el tamaño.",
							"How much each mouse wheel step zooms in or out on maps (editor and embedded), in zoom levels. One level doubles the size.",
						),
						render: (setting) => this.sliderWithNumber(setting, "mapZoomStep", 0.1, 2, 0.05),
					},
					{
						name: T("Marco de la vista de jugadores", "Player view frame"),
						desc: T(
							"Con un mapa en la pantalla de jugadores, el editor muestra el marco de lo que se enviaría (discontinuo) y el rectángulo de lo que ven ahora (continuo).",
							"With a map on the player screen, the editor shows the frame of what would be sent (dashed) and the rectangle of what they see now (solid).",
						),
						control: { type: "toggle", key: "showPlayerFrame" },
					},
					{
						name: T("Transparencia de lo que no ven los jugadores", "Transparency of what players can't see"),
						desc: T(
							"Con un mapa en la pantalla de jugadores, los marcadores, rutas y zonas que ellos no ven se muestran así de transparentes en el editor (%).",
							"With a map on the player screen, the markers, routes and zones they can't see are shown this transparent in the editor (%).",
						),
						render: (setting) => this.sliderWithNumber(setting, "notPlayerTransparency", 0, 95, 1),
					},
					{
						name: T("Transparencia del relleno de las zonas", "Zone fill transparency"),
						desc: T("Transparencia (%) del relleno de todas las zonas, en el editor, en los mapas incrustados y en la pantalla de jugadores.", "Transparency (%) of every zone's fill, in the editor, embedded maps and the player screen."),
						render: (setting) => this.sliderWithNumber(setting, "zoneFillTransparency", 0, 100, 5),
					},
					{
						name: T("Mostrar lo que está bajo la niebla", "Show what's under the fog"),
						desc: T(
							"La pantalla de jugadores muestra los marcadores, las rutas y las zonas visibles para ellos aunque estén bajo la niebla de guerra.",
							"The player screen shows the markers, routes and zones visible to players even when they're under the fog of war.",
						),
						control: { type: "toggle", key: "fogShowUnder" },
					},
					{
						name: T("Color del láser", "Laser color"),
						desc: T(
							"Color del punto y de los trazos del láser. El lápiz empieza con este color; mientras está activo se cambia en la barra del mapa.",
							"Color of the laser dot and strokes. The pen starts with this color; while it's active you can change it in the map toolbar.",
						),
						control: { type: "color", key: "laserColor" },
					},
					{
						name: T("Tiempo del láser", "Laser fade time"),
						desc: T("Segundos que tardan en desvanecerse los trazos del láser al soltar el clic.", "Seconds it takes for laser strokes to fade after you release the click."),
						render: (setting) => this.sliderWithNumber(setting, "laserFadeSeconds", 0.5, 10, 0.5),
					},
					{
						name: T("Grosor del láser y el lápiz", "Laser and pen thickness"),
						desc: T(
							"Grosor de los trazos que se dibujan y del punto del láser, en píxeles. Los trazos del lápiz que ya existen conservan el suyo.",
							"Thickness of the strokes you draw and of the laser dot, in pixels. Existing pen strokes keep theirs.",
						),
						render: (setting) => this.sliderWithNumber(setting, "drawWidth", 1, 20, 1),
					},
					{
						name: T("Iconos SVG para marcadores y condiciones", "SVG icons for markers and conditions"),
						desc: this.iconsDescription(),
						render: (setting) => {
							const icons = this.plugin.icons;
							setting
								.addButton((b) => b.setButtonText(T("Importar SVG…", "Import SVG…")).onClick(() => this.plugin.importIcons(() => this.update())))
								.addButton((b) => b.setButtonText(T("Abrir carpeta", "Open folder")).onClick(() => icons.openFolder()))
								.addButton((b) =>
									b.setButtonText(T("Recargar", "Reload")).onClick(async () => {
										await this.plugin.reloadIcons();
										this.update();
									}),
								);
						},
					},
					{
						name: T("Carpeta para mapas nuevos", "Folder for new maps"),
						desc: T("Vacío = en la misma carpeta que la imagen.", "Empty = the same folder as the image."),
						control: { type: "text", key: "mapFolder", placeholder: T("Mapas", "Maps") },
					},
				],
			},
		];
	}

	/**
	 * Deslizador y campo numérico sincronizados, como en el editor de retratos: un `input range`
	 * nativo (sin el valor que Obsidian añade a sus deslizadores) y el número a la derecha.
	 * Mientras se arrastra se aplica en directo; se guarda al soltar. Obsidian reutiliza la fila al
	 * llamar a `update()`: se vacían los controles antes de volver a crearlos.
	 */
	private sliderWithNumber(setting: Setting, key: "mapZoomStep" | "notPlayerTransparency" | "laserFadeSeconds" | "drawWidth" | "zoneFillTransparency", min: number, max: number, step: number): void {
		const el = setting.controlEl;
		el.empty();
		const value = this.plugin.settings[key];
		const slider = el.createEl("input", { type: "range", cls: "slider", attr: { min: String(min), max: String(max), step: String(step) } });
		slider.value = String(value);
		// Campo de texto (no numérico): acepta coma y punto, y se muestra siempre con punto.
		const num = el.createEl("input", { cls: "strakes-setting-number" });
		decimalInput(num);
		num.value = String(value);
		slider.addEventListener("input", () => {
			num.value = slider.value;
			this.plugin.settings[key] = parseFloat(slider.value);
			this.plugin.events.trigger("settings");
		});
		slider.addEventListener("change", () => void this.setControlValue(key, parseFloat(slider.value)));
		num.addEventListener("input", () => {
			const n = parseDecimal(num.value);
			if (!isFinite(n) || n < min || n > max) return;
			slider.value = String(n);
			void this.setControlValue(key, n);
		});
		// Al salir del campo (o con Enter), un valor inválido o fuera de rango vuelve al guardado.
		num.addEventListener("change", () => (num.value = String(this.plugin.settings[key])));
	}

	private iconsDescription(): string {
		const icons = this.plugin.icons;
		const n = icons.names().length;
		return T(
			`${n} icono${n === 1 ? "" : "s"} en «${icons.dir}». Copia ahí tus archivos .svg o impórtalos. Se conservan al actualizar el plugin (no al desinstalarlo).`,
			`${n} icon${n === 1 ? "" : "s"} in "${icons.dir}". Copy your .svg files there or import them. They are kept when the plugin updates (not when it's uninstalled).`,
		);
	}

	/**
	 * Atribución del SRD (exigida por su licencia) y cuadrícula de condiciones integradas, bajo
	 * su fila. Obsidian reutiliza la fila al llamar a `update()` y vuelve a ejecutar este
	 * `render`: el bloque anterior se quita primero (y al desmontar la fila), para no duplicarlo.
	 */
	private renderBuiltinConditions(setting: Setting): () => void {
		const s = this.plugin.settings;
		setting.settingEl.addClass("strakes-setting-wide");
		for (const old of Array.from(setting.settingEl.querySelectorAll(":scope > .strakes-setting-block"))) old.remove();
		const block = setting.settingEl.createDiv("strakes-setting-block");
		// Atribución exigida por la licencia CC-BY-4.0 del SRD 5.2 (texto oficial, en inglés).
		const attribution = block.createDiv("strakes-srd-attribution");
		attribution.appendText(
			"This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at ",
		);
		attribution.createEl("a", { text: SRD_URL, href: SRD_URL });
		attribution.appendText(". The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at ");
		attribution.createEl("a", { text: CC_BY_URL, href: CC_BY_URL });
		attribution.appendText(".");
		const grid = block.createDiv("strakes-builtin-cond-grid");
		// También las ocultas (atenuadas): es el único sitio desde el que se vuelven a mostrar.
		for (const info of allConditions(s, { includeHidden: true }).filter((x) => !x.custom)) {
			const b = grid.createEl("button", { cls: "strakes-builtin-cond" });
			b.toggleClass("is-hidden", info.hidden);
			renderConditionIcon(b.createSpan(), info);
			b.createSpan({ text: info.name });
			if (info.hidden) {
				const eye = b.createSpan({ cls: "strakes-builtin-cond-hidden" });
				setIcon(eye, "eye-off");
				setTooltip(b, T("Oculta: no aparece en ningún menú ni se aplica", "Hidden: not shown in any menu nor applied"));
			} else if (s.conditionOverrides[info.id]) b.createSpan({ cls: "strakes-builtin-cond-mark", text: "•" });
			b.onclick = () => new ConditionModal(this.app, this.plugin, { kind: "builtin", id: info.id }).open();
		}
		return () => block.remove();
	}

	/** Papelera de la lista de condiciones personalizadas: pide confirmación y la quita también de los combatientes. */
	private async deleteCustomCondition(index: number): Promise<void> {
		const s = this.plugin.settings;
		const cond = s.customConditions[index];
		if (!cond) return;
		const ok = await confirmDialog(
			this.app,
			T("Eliminar condición", "Delete condition"),
			T(
				`¿Eliminar «${cond.name}»? También se quitará de los combatientes que la tengan.`,
				`Delete "${cond.name}"? It will also be removed from any combatants that have it.`,
			),
		);
		if (ok) {
			s.customConditions = s.customConditions.filter((x) => x.id !== cond.id);
			for (const c of s.combat.combatants) c.conditions = c.conditions.filter((e) => e.id !== cond.id);
			await this.plugin.saveSettings();
			this.plugin.events.trigger("combat");
		}
		// Se redibuja siempre: si se canceló, la fila vuelve a aparecer.
		this.update();
	}
}
