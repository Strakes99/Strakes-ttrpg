import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { T } from "./i18n";
import type StrakesTTRPG from "./main";
import { ConditionModal, renderConditionIcon } from "./initiative/conditionUi";
import { allConditions, CC_BY_URL, customInfo, SRD_URL } from "./initiative/conditions";
import { confirmDialog } from "./ui/modals";
import { MapView } from "./map/MapView";
import { StrakesSettings, VIEW_TYPE_MAP } from "./types";

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
		if (key === "defaultUnit" && typeof value === "string") value = value.trim();
		if (key === "mapFolder" && typeof value === "string") value = value.trim().replace(/\/+$/, "");
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.save();
		if (key === "displayUnit")
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MAP)) if (leaf.view instanceof MapView) leaf.view.refreshUnits();
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
							"Haz clic en una para editarla por completo (nombre, descripción, icono, color, condiciones que aplica, niveles). Las modificadas se marcan con un punto.",
							"Click one to fully edit it (name, description, icon, color, conditions it applies, levels). Modified ones are marked with a dot.",
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
									.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond: null }, () => this.update()).open()),
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
					desc: cond.description.split("\n")[0] ?? "",
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
								.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond }, () => this.update()).open()),
						);
					},
				})),
			},
			{
				type: "group",
				heading: T("Mapas", "Maps"),
				items: [
					{
						name: T("Unidad por defecto", "Default unit"),
						desc: T("Unidad de distancia de los mapas nuevos.", "Distance unit for new maps."),
						control: { type: "text", key: "defaultUnit" },
					},
					{
						name: T("Unidades para mostrar", "Display units"),
						desc: T(
							"Convierte al mostrarlas las distancias y velocidades de todos los mapas. Lo que escribes en cada mapa se guarda siempre en su propia unidad y no cambia.",
							"Converts the distances and speeds of every map when they're displayed. What you enter in each map is always stored in its own unit and never changes.",
						),
						control: {
							type: "dropdown",
							key: "displayUnit",
							options: { map: T("Las de cada mapa", "Each map's own"), km: T("Kilómetros", "Kilometers"), mi: T("Millas", "Miles") },
						},
					},
					{
						name: T("Título en la vista previa de los marcadores", "Title in marker previews"),
						desc: T(
							"Muestra el nombre de la nota (y el encabezado, si lo hay) encima de la vista previa al pasar el cursor con Ctrl sobre un marcador.",
							"Shows the note name (and the heading, if any) above the preview when you Ctrl+hover a marker.",
						),
						control: { type: "toggle", key: "pinPreviewTitle" },
					},
					{
						name: T("Iconos SVG para marcadores", "SVG icons for markers"),
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
		for (const info of allConditions(s).filter((x) => !x.custom)) {
			const b = grid.createEl("button", { cls: "strakes-builtin-cond" });
			renderConditionIcon(b.createSpan(), info);
			b.createSpan({ text: info.name });
			if (s.conditionOverrides[info.id]) b.createSpan({ cls: "strakes-builtin-cond-mark", text: "•" });
			b.onclick = () => new ConditionModal(this.app, this.plugin, { kind: "builtin", id: info.id }, () => this.update()).open();
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
