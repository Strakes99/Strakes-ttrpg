import { App, PluginSettingTab, Setting } from "obsidian";
import type StrakesTTRPG from "./main";
import { ConditionModal, renderConditionIcon } from "./initiative/conditionUi";
import { allConditions, CC_BY_URL, customInfo, SRD_URL } from "./initiative/conditions";
import { confirmDialog } from "./ui/modals";
import { OverlayPosition } from "./types";

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

		new Setting(containerEl).setName("Pantalla de jugadores").setHeading();
		new Setting(containerEl)
			.setName("Color de fondo")
			.addColorPicker((c) =>
				c.setValue(s.playerBackground).onChange(async (v) => {
					s.playerBackground = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Tamaño de letra")
			.setDesc("Tamaño base del texto de las notas enviadas (px).")
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

		new Setting(containerEl).setName("Iniciativa").setHeading();
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
			"Tamaño de las tarjetas",
			"Modo Tarjetas: ancho y alto del retrato, en píxeles. Las tarjetas que no caben en una fila pasan a la siguiente; el retrato solo se reduce si no caben en la ventana.",
			() => s.cardSize,
			(v) => (s.cardSize = v),
			60,
			800,
		);
		pxSetting("Separación entre tarjetas", "Modo Tarjetas: espacio entre tarjetas, en píxeles.", () => s.cardGap, (v) => (s.cardGap = v), 0, 200);
		pxSetting(
			"Tamaño del texto",
			"Texto de la iniciativa en la pantalla de jugadores (Lista y nombres y PV de las Tarjetas), en píxeles. Se respeta siempre: para que todo quepa se reparten columnas o se reducen los retratos, nunca el texto.",
			() => s.initiativeTextSize,
			(v) => (s.initiativeTextSize = v),
			8,
			96,
		);

		new Setting(containerEl).setName("Posición de la lista").addDropdown((dd) =>
			dd
				.addOptions({
					"top-left": "Arriba a la izquierda",
					"top-right": "Arriba a la derecha",
					"bottom-left": "Abajo a la izquierda",
					"bottom-right": "Abajo a la derecha",
				})
				.setValue(s.overlayPosition)
				.onChange(async (v) => {
					s.overlayPosition = v as OverlayPosition;
					await save();
				}),
		);
		new Setting(containerEl)
			.setName("Mostrar PV de los PJ y aliados")
			.setDesc("Los jugadores ven los puntos de vida de sus personajes y de los aliados.")
			.addToggle((t) =>
				t.setValue(s.showPlayerHp).onChange(async (v) => {
					s.showPlayerHp = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Mostrar PV de los enemigos")
			.setDesc("Los jugadores ven los puntos de vida de los enemigos visibles.")
			.addToggle((t) =>
				t.setValue(s.showNpcHp).onChange(async (v) => {
					s.showNpcHp = v;
					await save();
				}),
			);

		// Condiciones de las reglas básicas: clic para cambiar su icono y color.
		new Setting(containerEl)
			.setName("Condiciones de las reglas básicas")
			.setDesc("Haz clic en una para editarla por completo (nombre, descripción, icono, color, condiciones que aplica, niveles). Las modificadas se marcan con un punto.");
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
			.setName("Condiciones personalizadas")
			.setDesc("Se añaden a la lista del tracker, con su propio icono y color (sin fondo). Pueden aplicar otras condiciones y ser acumulativas.")
			.addButton((b) =>
				b
					.setButtonText("Nueva condición…")
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
					.setTooltip("Editar")
					.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond }, () => this.display()).open()),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Eliminar")
					.onClick(async () => {
						const ok = await confirmDialog(
							this.app,
							"Eliminar condición",
							`¿Eliminar «${cond.name}»? También se quitará de los combatientes que la tengan.`,
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

		new Setting(containerEl).setName("Mapas").setHeading();
		new Setting(containerEl)
			.setName("Unidad por defecto")
			.setDesc("Unidad de distancia de los mapas nuevos.")
			.addText((t) =>
				t.setValue(s.defaultUnit).onChange(async (v) => {
					s.defaultUnit = v.trim();
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Título en la vista previa de los marcadores")
			.setDesc("Muestra el nombre de la nota (y el encabezado, si lo hay) encima de la vista previa al pasar el cursor con Ctrl sobre un marcador.")
			.addToggle((t) =>
				t.setValue(s.pinPreviewTitle).onChange(async (v) => {
					s.pinPreviewTitle = v;
					await save();
				}),
			);
		const icons = this.plugin.icons;
		const n = icons.names().length;
		new Setting(containerEl)
			.setName("Iconos SVG para marcadores")
			.setDesc(
				`${n} icono${n === 1 ? "" : "s"} en «${icons.dir}». Copia ahí tus archivos .svg o impórtalos. ` +
					"Se conservan al actualizar el plugin (no al desinstalarlo).",
			)
			.addButton((b) => b.setButtonText("Importar SVG…").onClick(() => this.plugin.importIcons(() => this.display())))
			.addButton((b) => b.setButtonText("Abrir carpeta").onClick(() => icons.openFolder()))
			.addButton((b) =>
				b.setButtonText("Recargar").onClick(async () => {
					await this.plugin.reloadIcons();
					this.display();
				}),
			);
		new Setting(containerEl)
			.setName("Carpeta para mapas nuevos")
			.setDesc("Vacío = en la misma carpeta que la imagen.")
			.addText((t) =>
				t
					.setPlaceholder("Mapas")
					.setValue(s.mapFolder)
					.onChange(async (v) => {
						s.mapFolder = v.trim().replace(/\/+$/, "");
						await save();
					}),
			);
	}
}
