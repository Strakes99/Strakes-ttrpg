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
				!Number.isInteger(v) || v < min || v > max ? T("settings.aWholeNumberBetweenAnd", { min, max }) : undefined,
		});
		return [
			{
				type: "group",
				heading: T("settings.playerScreen"),
				items: [
					{ name: T("settings.backgroundColor"), control: { type: "color", key: "playerBackground" } },
					{
						name: T("settings.fontSize"),
						desc: T("settings.baseTextSizeOfThe"),
						control: { type: "slider", key: "playerFontSize", min: 12, max: 48, step: 1 },
					},
				],
			},
			{
				type: "group",
				heading: T("settings.initiative"),
				items: [
					{
						name: T("settings.cardSize"),
						desc: T("settings.cardsModeWidthAndHeight"),
						control: { key: "cardSize", ...px(60, 800) },
					},
					{
						name: T("settings.cardSpacing"),
						desc: T("settings.cardsModeSpaceBetweenCards"),
						control: { key: "cardGap", ...px(0, 200) },
					},
					{
						name: T("settings.textSize"),
						desc: T("settings.initiativeTextOnThePlayer"),
						control: { key: "initiativeTextSize", ...px(8, 96) },
					},
					{
						name: T("settings.listPosition"),
						control: {
							type: "dropdown",
							key: "overlayPosition",
							options: {
								"top-left": T("settings.topLeft"),
								"top-right": T("settings.topRight"),
								"bottom-left": T("settings.bottomLeft"),
								"bottom-right": T("settings.bottomRight"),
							},
						},
					},
					{
						name: T("settings.showHpOfPcsAnd"),
						desc: T("settings.playersSeeTheHitPoints"),
						control: { type: "toggle", key: "showPlayerHp" },
					},
					{
						name: T("settings.showHpOfEnemies"),
						desc: T("settings.playersSeeTheHitPoints2"),
						control: { type: "toggle", key: "showNpcHp" },
					},
					{
						name: T("settings.basicRulesConditions"),
						desc: T("settings.clickOneToFullyEdit"),
						render: (setting) => this.renderBuiltinConditions(setting),
					},
					{
						name: T("settings.customConditions"),
						desc: T("settings.theyAreAddedToThe"),
						render: (setting) => {
							setting.addButton((b) =>
								b
									.setButtonText(T("settings.newCondition"))
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
								.setTooltip(T("settings.edit"))
								.onClick(() => new ConditionModal(this.app, this.plugin, { kind: "custom", cond }).open()),
						);
					},
				})),
			},
			{
				type: "group",
				heading: T("settings.maps"),
				items: [
					{
						name: T("settings.unitForNewMaps"),
						desc: T("settings.newMapsAreCreatedWith"),
						control: {
							type: "dropdown",
							key: "displayUnit",
							options: Object.fromEntries(unitOptions().map((o) => [o.value, o.label])),
						},
					},
					{
						name: T("settings.titleInMarkerPreviews"),
						desc: T("settings.showsTheNoteNameAbove"),
						control: { type: "toggle", key: "pinPreviewTitle" },
					},
					{
						name: T("settings.lockEmbeddedMaps"),
						desc: T("settings.locksZoomAndDraggingOn"),
						control: { type: "toggle", key: "lockAllEmbeds" },
					},
					{
						name: T("settings.zoomStep"),
						desc: T("settings.howMuchEachMouseWheel"),
						render: (setting) => this.sliderWithNumber(setting, "mapZoomStep", 0.1, 2, 0.05),
					},
					{
						name: T("settings.playerViewFrame"),
						desc: T("settings.withAMapOnThe"),
						control: { type: "toggle", key: "showPlayerFrame" },
					},
					{
						name: T("settings.transparencyOfWhatPlayersCant"),
						desc: T("settings.withAMapOnThe2"),
						render: (setting) => this.sliderWithNumber(setting, "notPlayerTransparency", 0, 95, 1),
					},
					{
						name: T("settings.zoneFillTransparency"),
						desc: T("settings.transparencyOfEveryZonesFill"),
						render: (setting) => this.sliderWithNumber(setting, "zoneFillTransparency", 0, 100, 5),
					},
					{
						name: T("settings.showWhatsUnderTheFog"),
						desc: T("settings.thePlayerScreenShowsThe"),
						control: { type: "toggle", key: "fogShowUnder" },
					},
					{
						name: T("settings.laserColor"),
						desc: T("settings.colorOfTheLaserDot"),
						control: { type: "color", key: "laserColor" },
					},
					{
						name: T("settings.laserFadeTime"),
						desc: T("settings.secondsItTakesForLaser"),
						render: (setting) => this.sliderWithNumber(setting, "laserFadeSeconds", 0.5, 10, 0.5),
					},
					{
						name: T("settings.laserAndPenThickness"),
						desc: T("settings.thicknessOfTheStrokesYou"),
						render: (setting) => this.sliderWithNumber(setting, "drawWidth", 1, 20, 1),
					},
					{
						name: T("settings.svgIconsForMarkersAnd"),
						desc: this.iconsDescription(),
						render: (setting) => {
							const icons = this.plugin.icons;
							setting
								.addButton((b) => b.setButtonText(T("settings.importSvg")).onClick(() => this.plugin.importIcons(() => this.update())))
								.addButton((b) => b.setButtonText(T("settings.openFolder")).onClick(() => icons.openFolder()))
								.addButton((b) =>
									b.setButtonText(T("settings.reload")).onClick(async () => {
										await this.plugin.reloadIcons();
										this.update();
									}),
								);
						},
					},
					{
						name: T("settings.folderForNewMaps"),
						desc: T("settings.emptyTheSameFolderAs"),
						control: { type: "text", key: "mapFolder", placeholder: T("settings.maps") },
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
		return T("settings.iconsInFolder", { count: n, dir: icons.dir });
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
				setTooltip(b, T("settings.hiddenNotShownInAny"));
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
			T("settings.deleteCondition"),
			T("settings.deleteItWillAlsoBe", { name: cond.name }),
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
