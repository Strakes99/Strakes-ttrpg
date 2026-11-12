import { App, PluginSettingTab, Setting } from "obsidian";
import { T } from "./i18n";
import type StrakesTTRPG from "./main";
import { ConditionModal, renderConditionIcon } from "./initiative/conditionUi";
import { allConditions, CC_BY_URL, customInfo, SRD_URL } from "./initiative/conditions";
import { confirmDialog } from "./ui/modals";
import { MapView } from "./map/MapView";
import { OverlayPosition, VIEW_TYPE_MAP } from "./types";

export class StrakesSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: StrakesTTRPG) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
			this.plugin.events.trigger("settings");
		};
		containerEl.empty();

		new Setting(containerEl).setName(T("Pantalla de jugadores", "Player screen")).setHeading();
		new Setting(containerEl)
			.setName(T("Color de fondo", "Background color"))
			.addColorPicker((c) =>
				c.setValue(s.playerBackground).onChange(async (v) => {
					s.playerBackground = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName(T("Tamaño de letra", "Font size"))
			.setDesc(T("Tamaño base del texto de las notas enviadas (px).", "Base text size of the notes you send (px)."))
			.addSlider((sl) =>
				sl
					.setLimits(12, 48, 1)
					.setValue(s.playerFontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.playerFontSize = v;
						await save();
					}),
			);

		new Setting(containerEl).setName(T("Iniciativa", "Initiative")).setHeading();
		// Modo Tarjetas: lado del retrato (= ancho de la tarjeta) y separación entre tarjetas.
		const pxSetting = (name: string, desc: string, get: () => number, set: (v: number) => void, min: number, max: number) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) => {
					t.inputEl.type = "number";
					t.inputEl.min = String(min);
					t.inputEl.max = String(max);
					t.inputEl.addClass("strakes-px-input");
					t.setValue(String(get())).onChange(async (v) => {
						const n = parseInt(v, 10);
						if (isNaN(n)) return;
						set(Math.min(max, Math.max(min, n)));
						await save();
					});
				});
		pxSetting(
			T("Tamaño de las tarjetas", "Card size"),
			T(
				"Modo Tarjetas: ancho y alto del retrato, en píxeles. Las tarjetas que no caben en una fila pasan a la siguiente; el retrato solo se reduce si no caben en la ventana.",
				"Cards mode: width and height of the portrait, in pixels. Cards that don't fit in a row wrap to the next one; the portrait only shrinks if they don't fit in the window.",
			),
			() => s.cardSize,
			(v) => (s.cardSize = v),
			60,
			800,
		);
		pxSetting(
			T("Separación entre tarjetas", "Card spacing"),
			T("Modo Tarjetas: espacio entre tarjetas, en píxeles.", "Cards mode: space between cards, in pixels."),
			() => s.cardGap,
			(v) => (s.cardGap = v),
			0,
			200,
		);
		pxSetting(
			T("Tamaño del texto", "Text size"),
			T(
				"Texto de la iniciativa en la pantalla de jugadores (Lista y nombres y PG de las Tarjetas), en píxeles. Se respeta siempre: para que todo quepa se reparten columnas o se reducen los retratos, nunca el texto.",
				"Initiative text on the player screen (List, and names and HP on Cards), in pixels. It is always respected: to make everything fit, the list splits into columns or portraits shrink, never the text.",
			),
			() => s.initiativeTextSize,
			(v) => (s.initiativeTextSize = v),
			8,
			96,
		);

		new Setting(containerEl).setName(T("Posición de la lista", "List position")).addDropdown((dd) =>
			dd
				.addOptions({
					"top-left": T("Arriba a la izquierda", "Top left"),
					"top-right": T("Arriba a la derecha", "Top right"),
					"bottom-left": T("Abajo a la izquierda", "Bottom left"),
					"bottom-right": T("Abajo a la derecha", "Bottom right"),
				})
				.setValue(s.overlayPosition)
				.onChange(async (v) => {
					s.overlayPosition = v as OverlayPosition;
					await save();
				}),
		);
		new Setting(containerEl)
			.setName(T("Mostrar PG de los PJ y aliados", "Show HP of PCs and allies"))
			.setDesc(T("Los jugadores ven los puntos de golpe de sus personajes y de los aliados.", "Players see the hit points of their characters and of allies."))
			.addToggle((t) =>
				t.setValue(s.showPlayerHp).onChange(async (v) => {
					s.showPlayerHp = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName(T("Mostrar PG de los enemigos", "Show HP of enemies"))
			.setDesc(T("Los jugadores ven los puntos de golpe de los enemigos visibles.", "Players see the hit points of visible enemies."))
			.addToggle((t) =>
				t.setValue(s.showNpcHp).onChange(async (v) => {
					s.showNpcHp = v;
					await save();
				}),
			);

		// Condiciones de las reglas básicas: clic para cambiar su icono y color.
		new Setting(containerEl)
			.setName(T("Condiciones de las reglas básicas", "Basic rules conditions"))
			.setDesc(
				T(
					"Haz clic en una para editarla por completo (nombre, descripción, icono, color, condiciones que aplica, niveles). Las modificadas se marcan con un punto.",
					"Click one to fully edit it (name, description, icon, color, conditions it applies, levels). Modified ones are marked with a dot.",
				),
			);
		// Atribución exigida por la licencia CC-BY-4.0 del SRD 5.2 (texto oficial, en inglés).
		const attribution = containerEl.createDiv("strakes-srd-attribution");
		attribution.appendText(
			"This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at ",
		);
		attribution.createEl("a", { text: SRD_URL, href: SRD_URL });
		attribution.appendText(". The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at ");
		attribution.createEl("a", { text: CC_BY_URL, href: CC_BY_URL });
		attribution.appendText(".");
		const grid = containerEl.createDiv("strakes-builtin-cond-grid");
		for (const info of allConditions(s).filter((x) => !x.custom)) {
			const b = grid.createEl("button", { cls: "strakes-builtin-cond" });
			renderConditionIcon(b.createSpan(), info);
			b.createSpan({ text: info.name });
			if (s.conditionOverrides[info.id]) b.createSpan({ cls: "strakes-builtin-cond-mark", text: "•" });
			b.onclick = () => new ConditionModal(this.app, this.plugin, { kind: "builtin", id: info.id }, () => this.display()).open();
		}

		// Condiciones personalizadas (además de las de las reglas básicas).
		new Setting(containerEl)
			.setName(T("Condiciones personalizadas", "Custom conditions"))
			.setDesc(
				T(
					"Se añaden a la lista del tracker, con su propio icono y color (sin fondo). Pueden aplicar otras condiciones y ser acumulativas.",
					"They are added to the tracker's list, with their own icon and color (no background). They can apply other conditions and be cumulative.",
				),
			)
			.addButton((b) =>
				b
					.setButtonText(T("Nueva condición…", "New condition…"))
					.setCta()
					.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond: null }, () => this.display()).open()),
			);
		for (const cond of s.customConditions) {
			const row = new Setting(containerEl).setName(cond.name).setDesc(cond.description.split("\n")[0] ?? "");
			row.settingEl.addClass("strakes-custom-cond-row");
			const iconEl = createSpan();
			renderConditionIcon(iconEl, customInfo(cond));
			row.nameEl.prepend(iconEl);
			row.addExtraButton((b) =>
				b
					.setIcon("pencil")
					.setTooltip(T("Editar", "Edit"))
					.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond }, () => this.display()).open()),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip(T("Eliminar", "Delete"))
					.onClick(async () => {
						const ok = await confirmDialog(
							this.app,
							T("Eliminar condición", "Delete condition"),
							T(
								`¿Eliminar «${cond.name}»? También se quitará de los combatientes que la tengan.`,
								`Delete "${cond.name}"? It will also be removed from any combatants that have it.`,
							),
						);
						if (!ok) return;
						s.customConditions = s.customConditions.filter((x) => x.id !== cond.id);
						for (const c of s.combat.combatants) c.conditions = c.conditions.filter((e) => e.id !== cond.id);
						await this.plugin.saveSettings();
						this.plugin.events.trigger("combat");
						this.display();
					}),
			);
		}

		new Setting(containerEl).setName(T("Mapas", "Maps")).setHeading();
		new Setting(containerEl)
			.setName(T("Unidad por defecto", "Default unit"))
			.setDesc(T("Unidad de distancia de los mapas nuevos.", "Distance unit for new maps."))
			.addText((t) =>
				t.setValue(s.defaultUnit).onChange(async (v) => {
					s.defaultUnit = v.trim();
					await save();
				}),
			);
		new Setting(containerEl)
			.setName(T("Unidades para mostrar", "Display units"))
			.setDesc(
				T(
					"Convierte al mostrarlas las distancias y velocidades de todos los mapas. Lo que escribes en cada mapa se guarda siempre en su propia unidad y no cambia.",
					"Converts the distances and speeds of every map when they're displayed. What you enter in each map is always stored in its own unit and never changes.",
				),
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						map: T("Las de cada mapa", "Each map's own"),
						km: T("Kilómetros", "Kilometers"),
						mi: T("Millas", "Miles"),
					})
					.setValue(s.displayUnit)
					.onChange(async (v) => {
						s.displayUnit = v as typeof s.displayUnit;
						await save();
						for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MAP))
							if (leaf.view instanceof MapView) leaf.view.refreshUnits();
					}),
			);
		new Setting(containerEl)
			.setName(T("Título en la vista previa de los marcadores", "Title in marker previews"))
			.setDesc(
				T(
					"Muestra el nombre de la nota (y el encabezado, si lo hay) encima de la vista previa al pasar el cursor con Ctrl sobre un marcador.",
					"Shows the note name (and the heading, if any) above the preview when you Ctrl+hover a marker.",
				),
			)
			.addToggle((t) =>
				t.setValue(s.pinPreviewTitle).onChange(async (v) => {
					s.pinPreviewTitle = v;
					await save();
				}),
			);
		const icons = this.plugin.icons;
		const n = icons.names().length;
		new Setting(containerEl)
			.setName(T("Iconos SVG para marcadores", "SVG icons for markers"))
			.setDesc(
				T(
					`${n} icono${n === 1 ? "" : "s"} en «${icons.dir}». Copia ahí tus archivos .svg o impórtalos. Se conservan al actualizar el plugin (no al desinstalarlo).`,
					`${n} icon${n === 1 ? "" : "s"} in "${icons.dir}". Copy your .svg files there or import them. They are kept when the plugin updates (not when it's uninstalled).`,
				),
			)
			.addButton((b) => b.setButtonText(T("Importar SVG…", "Import SVG…")).onClick(() => this.plugin.importIcons(() => this.display())))
			.addButton((b) => b.setButtonText(T("Abrir carpeta", "Open folder")).onClick(() => icons.openFolder()))
			.addButton((b) =>
				b.setButtonText(T("Recargar", "Reload")).onClick(async () => {
					await this.plugin.reloadIcons();
					this.display();
				}),
			);
		new Setting(containerEl)
			.setName(T("Carpeta para mapas nuevos", "Folder for new maps"))
			.setDesc(T("Vacío = en la misma carpeta que la imagen.", "Empty = the same folder as the image."))
			.addText((t) =>
				t
					.setPlaceholder(T("Mapas", "Maps"))
					.setValue(s.mapFolder)
					.onChange(async (v) => {
						s.mapFolder = v.trim().replace(/\/+$/, "");
						await save();
					}),
			);
	}
}
