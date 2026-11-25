import { App, ButtonComponent, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionPage, setIcon, setTooltip } from "obsidian";
import { setTranslateContent, T, TranslationKey } from "./i18n";
import type StrakesTTRPG from "./main";
import { ConditionModal, deleteCustomCondition, renderConditionIcon } from "./initiative/conditionUi";
import { allConditions, CC_BY_URL, customInfo, SRD_URL } from "./initiative/conditions";
import { decimalInput, parseDecimal } from "./ui/dom";
import { unitOptions } from "./map/mapData";
import { importStatblocks } from "./statblock/importUi";
import { createBestiaryBase } from "./statblock/bestiary";
import { allPresets, BUILTIN_PRESET, copyPreset, defaultPreset, freePresetName, Hideable, HIDEABLE, StatblockPreset } from "./statblock/presets";
import { confirmDialog } from "./ui/modals";

/** Claves de los controles de un preset: `preset:<id>:<campo>` (`columns`, `metric`, `show:<parte>`). */
const presetKey = (p: StatblockPreset, field: string) => `preset:${p.id}:${field}`;

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
	/** Los controles de los presets (`preset:…`) leen del preset; los demás, de los ajustes. */
	getControlValue(key: string): unknown {
		const m = /^preset:([^:]+):(.+)$/.exec(key);
		if (!m) return super.getControlValue(key);
		const p = this.plugin.settings.statblockPresets.find((x) => x.id === m[1]);
		if (!p) return undefined;
		if (m[2] === "columns") return String(p.columns);
		if (m[2] === "metric") return p.metric;
		if (m[2].startsWith("show:")) return !p.hidden.includes(m[2].slice(5) as Hideable);
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const m = /^preset:([^:]+):(.+)$/.exec(key);
		if (m) {
			const p = this.plugin.settings.statblockPresets.find((x) => x.id === m[1]);
			if (!p) return;
			if (m[2] === "columns") p.columns = value === "2" ? 2 : 1;
			else if (m[2] === "metric") p.metric = value === true;
			else if (m[2].startsWith("show:")) {
				const what = m[2].slice(5) as Hideable;
				p.hidden = value === true ? p.hidden.filter((h) => h !== what) : [...p.hidden.filter((h) => h !== what), what];
			}
			await this.save();
			return;
		}
		if ((key === "mapFolder" || key === "statblockFolder") && typeof value === "string") value = value.trim().replace(/\/+$/, "");
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		if (key === "translateContent") setTranslateContent(value === true);
		await this.save();
		// Los nombres de las condiciones del SRD de esta pestaña cambian de idioma.
		if (key === "translateContent") this.update();
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.events.trigger("settings");
	}

	getSettingDefinitions(): SettingDefinitionItem<string>[] {
		/** Número entero en píxeles dentro de un rango; fuera de él, Obsidian muestra el error y no lo guarda. */
		const px = (min: number, max: number) => ({
			type: "number" as const,
			min,
			max,
			step: 1,
			validate: (v: number) =>
				!Number.isInteger(v) || v < min || v > max ? T("settings.aWholeNumberBetweenAnd", { min, max }) : undefined,
		});
		// Cada sección es una página de los ajustes (1.4): la API de Obsidian no tiene secciones plegables, y
		// así la lista no queda tan agrupada. La atribución del SRD va al final de todo, fuera de las páginas.
		return [
			// General: afecta a statblocks y condiciones, así que va fuera de las páginas, al principio.
			{
				type: "group",
				items: [{ name: T("settings.translateContent"), desc: T("settings.translateContentDesc"), control: { type: "toggle", key: "translateContent" } }],
			},
			{
				type: "page",
				name: T("settings.playerScreen"),
				desc: T("settings.playerScreenPageDesc"),
				items: [{ type: "group", items: [
					{ name: T("settings.backgroundColor"), control: { type: "color", key: "playerBackground" } },
					{
						name: T("settings.fontSize"),
						desc: T("settings.baseTextSizeOfThe"),
						control: { type: "slider", key: "playerFontSize", min: 12, max: 48, step: 1 },
					},
				] }],
			},
			{
				type: "page",
				name: T("settings.initiative"),
				desc: T("settings.initiativePageDesc"),
				items: [{ type: "group", items: [
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
				] }],
			},
			{
				type: "page",
				name: T("settings.conditions"),
				desc: T("settings.conditionsPageDesc"),
				items: [{ type: "group", items: [
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
				] },
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
				}],
			},
			{
				type: "page",
				name: T("settings.maps"),
				desc: T("settings.mapsPageDesc"),
				items: [{ type: "group", items: [
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
				] }],
			},
			{
				type: "page",
				name: T("settings.statblocks"),
				desc: T("settings.statblocksPageDesc"),
				items: [{ type: "group", items: [
					{
						name: T("settings.importStatblocks"),
						desc: T("settings.importStatblocksDesc"),
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText(T("settings.importStatblocksButton")).onClick(() => importStatblocks(this.plugin)));
						},
					},
					{
						name: T("settings.statblockFolder"),
						desc: T("settings.statblockFolderDesc"),
						control: { type: "text", key: "statblockFolder", placeholder: "Statblocks" },
					},
					{
						name: T("settings.statblockPrefix"),
						desc: T("settings.statblockPrefixDesc"),
						control: { type: "text", key: "statblockPrefix", placeholder: "ST-" },
					},
					{
						name: T("settings.statblockSuffix"),
						desc: T("settings.statblockSuffixDesc"),
						control: { type: "text", key: "statblockSuffix" },
					},
					{
						name: T("settings.bestiaryBase"),
						desc: T("settings.bestiaryBaseDesc"),
						render: (setting: Setting) => {
							setting.addButton((b) => b.setButtonText(T("settings.bestiaryBaseButton")).onClick(() => void createBestiaryBase(this.plugin)));
						},
					},
					this.presetsPage(),
				] }],
			},
			// Atribución del SRD 5.2 (exigida por su licencia), al final de todo: habrá más datos del SRD.
			{ type: "group", heading: T("settings.srdAttribution"), items: [{ name: "SRD 5.2", desc: srdAttribution() }] },
		];
	}

	/**
	 * «Presentación de los statblocks» (paso 8): el preset general, «D&D 2024» (solo se duplica) y los del
	 * usuario, cada uno con su página. Se crean con + (copia del general) o con «Duplicar».
	 */
	private presetsPage(): SettingDefinitionPage<string> {
		const s = this.plugin.settings;
		const duplicate = (from: StatblockPreset) => (b: ButtonComponent) =>
			b.setButtonText(T("settings.duplicate")).onClick(() => void this.addPreset(copyPreset(s, from, T("settings.presetCopyName", { name: from.name }))));
		return {
			type: "page",
			name: T("settings.statblockDisplay"),
			desc: T("settings.statblockDisplayDesc"),
			displayValue: () => defaultPreset(s).name,
			items: [
				{
					type: "group",
					items: [
						{
							name: T("settings.defaultPreset"),
							desc: T("settings.defaultPresetDesc"),
							control: { type: "dropdown", key: "statblockPreset", options: Object.fromEntries(allPresets(s).map((p) => [p.id, p.name])) },
						},
						{ name: BUILTIN_PRESET.name, desc: T("settings.builtinPresetDesc"), render: (setting: Setting) => void setting.addButton(duplicate(BUILTIN_PRESET)) },
					],
				},
				{
					type: "list",
					heading: T("settings.yourPresets"),
					emptyState: T("settings.noPresets"),
					addItem: { name: T("settings.newPreset"), action: () => void this.addPreset(copyPreset(s, defaultPreset(s), T("settings.newPreset"))) },
					onDelete: (index) => void this.deletePreset(index),
					items: s.statblockPresets.map((p) => this.presetPage(p, duplicate(p))),
				},
			],
		};
	}

	/** La página de un preset del usuario: nombre, columnas, metros, qué se muestra y el orden. */
	private presetPage(p: StatblockPreset, duplicate: (b: ButtonComponent) => unknown): SettingDefinitionPage<string> {
		return {
			type: "page",
			name: p.name,
			items: [
				{
					type: "group",
					items: [
						{ name: T("settings.presetName"), desc: T("settings.presetNameDesc"), render: (setting: Setting) => this.presetNameField(setting, p) },
						{
							name: T("settings.statblockColumns"),
							desc: T("settings.statblockColumnsDesc"),
							control: { type: "dropdown", key: presetKey(p, "columns"), options: { "1": T("settings.oneColumn"), "2": T("settings.twoColumns") } },
						},
						{ name: T("settings.statblockMetric"), desc: T("settings.statblockMetricDesc"), control: { type: "toggle", key: presetKey(p, "metric") } },
						{ name: T("settings.duplicate"), render: (setting: Setting) => void setting.addButton(duplicate) },
					],
				},
				{
					type: "group",
					heading: T("settings.presetShow"),
					items: HIDEABLE.map((h) => ({ name: T(`sbPreset.show.${h}` as TranslationKey), control: { type: "toggle" as const, key: presetKey(p, `show:${h}`) } })),
				},
				{
					type: "list",
					heading: T("settings.presetOrder"),
					onReorder: (from, to) => void this.movePresetItem(p, from, to),
					items: p.order.map((item) => ({ name: T(`sbPreset.item.${item}` as TranslationKey) })),
				},
			],
		};
	}

	/**
	 * Campo del nombre: se guarda al salir de él (o con Enter), sin repetir el de otro preset (se le añade
	 * un número); vacío, vuelve al anterior. Luego se redibuja la pestaña (título de la página, desplegable).
	 * Obsidian reutiliza la fila en `update()`: se vacía antes.
	 */
	private presetNameField(setting: Setting, p: StatblockPreset): void {
		setting.controlEl.empty();
		const input = setting.controlEl.createEl("input", { type: "text" });
		input.value = p.name;
		input.addEventListener("change", () => {
			const name = input.value.trim();
			if (name && name !== p.name) p.name = freePresetName(this.plugin.settings, name, p.id);
			input.value = p.name;
			void this.save().then(() => this.update());
		});
	}

	private async addPreset(p: StatblockPreset): Promise<void> {
		this.plugin.settings.statblockPresets.push(p);
		await this.save();
		this.update();
	}

	/** Papelera de la lista de presets: pide confirmación. Si era el general, pasa a serlo «D&D 2024». */
	private async deletePreset(index: number): Promise<void> {
		const s = this.plugin.settings;
		const p = s.statblockPresets[index];
		if (p && (await confirmDialog(this.app, T("settings.deletePreset"), T("settings.deletePresetConfirm", { name: p.name })))) {
			s.statblockPresets.splice(index, 1);
			if (s.statblockPreset === p.id) s.statblockPreset = BUILTIN_PRESET.id;
			await this.save();
		}
		// Si se canceló, la fila vuelve.
		this.update();
	}

	private async movePresetItem(p: StatblockPreset, from: number, to: number): Promise<void> {
		const [item] = p.order.splice(from, 1);
		if (item) p.order.splice(to, 0, item);
		await this.save();
		this.update();
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
	 * Cuadrícula de condiciones integradas, bajo su fila. Obsidian reutiliza la fila al llamar a
	 * `update()` y vuelve a ejecutar este `render`: el bloque anterior se quita primero (y al
	 * desmontar la fila), para no duplicarlo.
	 */
	private renderBuiltinConditions(setting: Setting): () => void {
		const s = this.plugin.settings;
		setting.settingEl.addClass("strakes-setting-wide");
		for (const old of Array.from(setting.settingEl.querySelectorAll(":scope > .strakes-setting-block"))) old.remove();
		const block = setting.settingEl.createDiv("strakes-setting-block");
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
		const cond = this.plugin.settings.customConditions[index];
		// Si se eliminó, la función ya redibuja la pestaña; si se canceló, se redibuja para que la fila vuelva.
		if (!cond || !(await deleteCustomCondition(this.plugin, cond.id))) this.update();
	}
}

/** Atribución exigida por la licencia CC-BY-4.0 del SRD 5.2 (texto oficial, en inglés), con sus enlaces. */
function srdAttribution(): DocumentFragment {
	const frag = createFragment();
	frag.appendText("This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at ");
	frag.createEl("a", { text: SRD_URL, href: SRD_URL });
	frag.appendText(". The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at ");
	frag.createEl("a", { text: CC_BY_URL, href: CC_BY_URL });
	frag.appendText(".");
	return frag;
}
