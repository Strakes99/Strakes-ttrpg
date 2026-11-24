import { App, Component, MarkdownRenderer, Modal, Notice, Setting, setIcon, setTooltip } from "obsidian";
import { currentLanguage, T } from "../i18n";
import type StrakesTTRPG from "../main";
import { renderPinIconInto } from "../map/render";
import { Combatant, ConditionOverride, ConditionRules, CustomCondition, HpTrigger, RuleTarget, uid } from "../types";
import { IconColorControl, IconPicker } from "../ui/iconPicker";
import { confirmDialog, modalFooter } from "../ui/modals";
import { GridMenuItem, showGridMenu } from "../ui/gridMenu";
import { ActiveCondition, allConditions, BUILTIN_CONDITIONS, builtinInfo, combatantConditions, ConditionInfo } from "./conditions";
import { entryTooltipLines, renderEntryDetails } from "./conditionDetails";

const DEFAULT_CUSTOM_COLOR = "#e03131";

/** Pinta el icono de una condición (sin fondo) dentro de `el`. */
export function renderConditionIcon(el: HTMLElement, info: ConditionInfo): void {
	el.addClass("strakes-cond-icon");
	if (info.color) el.setCssStyles({ color: info.color });
	renderPinIconInto(el, info.icon, info.color, "circle-help");
	// Si el icono de Lucide no existe en esta versión de Obsidian, se usa la inicial.
	if (!el.firstChild) el.setText(info.name.charAt(0).toUpperCase());
}

export interface ConditionChipsOptions {
	/** Con interacción (panel del DM): clic = descripción, clic derecho = quitar. */
	interactive: boolean;
	/** Mostrar solo estas condiciones (p. ej. un enemigo derrotado solo muestra las que derrotan). */
	onlyIds?: string[];
	plugin: StrakesTTRPG;
}

/**
 * Iconos de las condiciones de un combatiente. Las aplicadas por otra condición o
 * automáticas se ven atenuadas. Las acumulativas muestran su nivel.
 */
export function renderConditionChips(container: HTMLElement, c: Combatant, opts: ConditionChipsOptions): void {
	const all = combatantConditions(c, opts.plugin.settings);
	const list = opts.onlyIds ? all.filter((a) => opts.onlyIds!.includes(a.info.id)) : all;
	for (const a of list) {
		const chip = container.createSpan("strakes-cond-chip");
		chip.toggleClass("is-implied", !a.explicit);
		renderConditionIcon(chip, a.info);
		if (a.level) chip.createSpan({ cls: "strakes-cond-level", text: String(a.level) });
		const title = a.level ? T("conditionUi.level", { name: a.info.name, level: a.level }) : a.info.name;
		// Datos de esta aplicación (duración, lanzador…): solo en el panel del DM.
		const entry = opts.interactive && a.explicit ? c.conditions.find((x) => x.id === a.info.id) : undefined;
		const extra = entry ? entryTooltipLines(opts.plugin.tracker, c, entry) : [];
		if (entry?.duration) {
			// Marca de duración: las rondas que quedan o un reloj de arena.
			const timer = chip.createSpan("strakes-cond-timer");
			if (entry.duration.kind === "rounds") timer.setText(String(entry.duration.left));
			else setIcon(timer, "hourglass");
		}
		const base = a.auto
			? T("conditionUi.automatic", { title, reason: a.reason })
			: a.explicit
				? title
				: T("conditionUi.appliedBy", { title, impliedBy: a.impliedBy.join(", ") });
		setTooltip(chip, [base, ...extra].join("\n"));
		if (!opts.interactive) continue;
		chip.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleConditionCard(chip, a, opts.plugin, c);
		});
		chip.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeConditionCard();
			// Automáticas: solo se avisa (se quitan solas).
			if (a.auto) {
				new Notice(
					T("conditionUi.isAutomaticItGoesAway", { name: a.info.name, reason: a.reason, endsWhen: a.endsWhen }),
				);
				return;
			}
			if (!a.explicit) {
				new Notice(
					T("conditionUi.isAppliedByRemoveThat", { name: a.info.name, impliedBy: a.impliedBy.join(", ") }),
				);
				return;
			}
			opts.plugin.tracker.removeCondition(c.id, a.info.id, { oneLevel: !!a.info.maxLevel });
		});
	}
}

// ---------- Ficha con la descripción (clic en el icono) ----------

let openCard: { el: HTMLElement; anchor: HTMLElement; cleanup: () => void } | null = null;

export function closeConditionCard(): void {
	if (!openCard) return;
	openCard.cleanup();
	openCard.el.remove();
	openCard = null;
}

/** Abre (o cierra, si ya estaba abierta) la descripción de la condición junto a su icono. */
function toggleConditionCard(anchor: HTMLElement, a: ActiveCondition, plugin: StrakesTTRPG, c: Combatant): void {
	const app = plugin.app;
	if (openCard?.anchor === anchor) {
		closeConditionCard();
		return;
	}
	closeConditionCard();
	const doc = anchor.doc;
	const card = doc.body.createDiv("strakes-cond-card");
	const head = card.createDiv("strakes-cond-card-head");
	renderConditionIcon(head.createSpan(), a.info);
	head.createSpan({ cls: "strakes-cond-card-title", text: a.level ? T("conditionUi.level2", { name: a.info.name, level: a.level }) : a.info.name });
	if (a.auto) card.createDiv({ cls: "strakes-cond-card-note", text: T("conditionUi.automatic2", { reason: a.reason }) });
	else if (!a.explicit)
		card.createDiv({ cls: "strakes-cond-card-note", text: T("conditionUi.appliedBy2", { impliedBy: a.impliedBy.join(", ") }) });
	// Descripción en Markdown (negrita, cursiva, encabezados…), con el renderizador de Obsidian.
	const text = card.createDiv("strakes-cond-card-text");
	const markdown = new Component();
	markdown.load();
	const description = a.info.description.trim();
	if (description) void MarkdownRenderer.render(app, description, text, "", markdown).then(() => place());
	else text.setText(T("conditionUi.noDescription"));
	// Las puestas a mano: duración, lanzador, salvación (y hechizo, si es una concentración).
	const entry = a.explicit ? c.conditions.find((x) => x.id === a.info.id) : undefined;
	if (entry) renderEntryDetails(card, plugin, c, entry, a.info);
	card.createDiv({
		cls: "strakes-cond-card-hint",
		text: a.auto ? T("conditionUi.itGoesAwayOnIts", { endsWhen: a.endsWhen }) : T("conditionUi.rightClickTheIconTo"),
	});

	// Posición: debajo del icono, sin salirse de la ventana (se recalcula al terminar el Markdown).
	const win = anchor.win;
	const place = () => {
		const r = anchor.getBoundingClientRect();
		const width = Math.min(300, win.innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8));
		card.setCssStyles({ width: `${width}px`, left: `${left}px`, top: `${r.bottom + 6}px` });
		// Si no cabe debajo, se abre encima.
		const h = card.offsetHeight;
		if (r.bottom + 6 + h > win.innerHeight - 8 && r.top - 6 - h > 8) card.setCssStyles({ top: `${r.top - 6 - h}px` });
	};
	place();

	const onDown = (e: MouseEvent) => {
		if (!card.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeConditionCard();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") closeConditionCard();
	};
	const onScroll = (e: Event) => {
		if (!card.contains(e.target as Node)) closeConditionCard();
	};
	doc.addEventListener("mousedown", onDown, true);
	doc.addEventListener("keydown", onKey, true);
	doc.addEventListener("scroll", onScroll, true);
	openCard = {
		el: card,
		anchor,
		cleanup: () => {
			doc.removeEventListener("mousedown", onDown, true);
			doc.removeEventListener("keydown", onKey, true);
			doc.removeEventListener("scroll", onScroll, true);
			markdown.unload();
		},
	};
}

// ---------- Desplegable para añadir / quitar ----------

/**
 * Menú con todas las condiciones (menos las ocultas): las activas, marcadas. Clic = añadir o quitar.
 * En orden alfabético (integradas y personalizadas juntas) y en columnas de 10 como máximo, para que no
 * se haga tan largo (1.4); «Nueva condición personalizada…», aparte, debajo.
 */
export function showConditionMenu(evt: MouseEvent, c: Combatant, plugin: StrakesTTRPG): void {
	const tracker = plugin.tracker;
	const active = new Map(c.conditions.map((e) => [e.id, e]));
	const effective = combatantConditions(c, plugin.settings);
	const implied = new Set(effective.filter((a) => !a.explicit && !a.auto).map((a) => a.info.id));
	const autoIds = new Set(effective.filter((a) => a.auto).map((a) => a.info.id));
	const item = (info: ConditionInfo): GridMenuItem => {
		const entry = active.get(info.id);
		let title = info.name;
		if (info.maxLevel)
			title += entry ? T("conditionUi.level3", { level: entry.level ?? 1, maxLevel: Math.min(info.maxLevel, (entry.level ?? 1) + 1) }) : "";
		else if (!entry && autoIds.has(info.id)) title += T("conditionUi.automatic3");
		else if (!entry && implied.has(info.id)) title += T("conditionUi.applied");
		return {
			title,
			checked: !!entry,
			renderIcon: (el) => renderConditionIcon(el, info),
			// Acumulativas: cada elección sube un nivel. Las demás: alternar.
			onClick: () => {
				if (info.maxLevel || !entry) tracker.addCondition(c.id, info.id, info.maxLevel);
				else tracker.removeCondition(c.id, info.id);
			},
		};
	};
	const collator = new Intl.Collator(currentLanguage());
	const all = [...allConditions(plugin.settings)].sort((a, b) => collator.compare(a.name, b.name));
	showGridMenu(evt, all.map(item), [
		{
			title: T("conditionUi.newCustomCondition"),
			icon: "plus",
			onClick: () => new ConditionModal(plugin.app, plugin, { kind: "custom", cond: null }, (created) => tracker.addCondition(c.id, created.id)).open(),
		},
	]);
}

// ---------- Diálogo de condición (personalizada o integrada) ----------

/** Qué se edita: una condición personalizada (nueva o existente) o una de las reglas básicas. */
export type ConditionTarget = { kind: "custom"; cond: CustomCondition | null } | { kind: "builtin"; id: string };

interface ConditionDraft {
	name: string;
	description: string;
	icon: string;
	color?: string;
	implies: string[];
	maxLevel?: number;
	rules: ConditionRules;
	/** Solo integradas. */
	hidden: boolean;
}

/** Automatismos sin campos vacíos (listas vacías, interruptores apagados), para guardar y comparar. */
function cleanRules(r: ConditionRules): ConditionRules {
	const out: ConditionRules = {};
	if (r.hpTriggers?.length) out.hpTriggers = r.hpTriggers.map((t) => (t.threshold === "percent" ? { ...t, percent: t.percent ?? 50 } : { threshold: t.threshold, who: t.who }));
	if (r.levelTriggers?.length) out.levelTriggers = r.levelTriggers.map((t) => ({ ...t }));
	if (r.leaves?.length) out.leaves = [...r.leaves];
	if (r.endsWith?.length) out.endsWith = [...r.endsWith];
	if (r.endsAtZeroHp) out.endsAtZeroHp = true;
	if (r.damageSave?.ability.trim()) out.damageSave = { ability: r.damageSave.ability.trim() };
	if (r.defeats) out.defeats = true;
	if (r.announce) out.announce = true;
	if (r.concentration) out.concentration = true;
	return out;
}

/** Comparación de automatismos sin depender del orden de las listas de condiciones. */
function sameRules(a: ConditionRules, b: ConditionRules): boolean {
	// cleanRules crea las claves siempre en el mismo orden, así que el JSON es comparable.
	const norm = (r: ConditionRules) => {
		const c = cleanRules(r);
		c.leaves?.sort();
		c.endsWith?.sort();
		return JSON.stringify(c);
	};
	return norm(a) === norm(b);
}

/**
 * Crear o editar una condición: nombre, descripción (Markdown), icono, color, condiciones
 * que aplica, si es acumulativa y sus automatismos. Integradas y personalizadas usan el
 * mismo diálogo; en las integradas los cambios se guardan aparte, «Restablecer» vuelve a
 * la original y se pueden ocultar.
 */
export class ConditionModal extends Modal {
	private draft: ConditionDraft;
	private iconPicker: IconPicker | null = null;
	private iconColor: IconColorControl | null = null;
	/** Valores originales de una condición integrada (para guardar solo lo que cambia). */
	private original: (ConditionDraft & { id: string }) | null = null;
	private customId: string;
	private rulesEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private target: ConditionTarget,
		/** Al guardar (no al cancelar). */
		private onDone?: (saved: { id: string }) => void,
	) {
		super(app);
		const toDraft = (info: ConditionInfo): ConditionDraft => ({
			name: info.name,
			description: info.description,
			icon: info.icon,
			color: info.color,
			implies: [...info.implies],
			maxLevel: info.maxLevel,
			rules: structuredClone(info.rules),
			hidden: info.hidden,
		});
		if (target.kind === "builtin") {
			const def = BUILTIN_CONDITIONS.find((b) => b.id === target.id)!;
			this.original = { id: def.id, ...toDraft(builtinInfo(def)) };
			this.draft = toDraft(builtinInfo(def, plugin.settings.conditionOverrides[def.id]));
			this.customId = def.id;
		} else {
			const c = target.cond;
			this.customId = c?.id ?? `custom-${uid()}`;
			this.draft = c
				? { name: c.name, description: c.description, icon: c.icon, color: c.color, implies: [...(c.implies ?? [])], maxLevel: c.maxLevel, rules: structuredClone(c.rules ?? {}), hidden: false }
				: { name: "", description: "", icon: "", color: DEFAULT_CUSTOM_COLOR, implies: [], rules: {}, hidden: false };
		}
	}

	/** Eliminar (personalizada ya guardada): pide confirmación, la quita y cierra el diálogo. */
	private async deleteThis(): Promise<void> {
		if (await deleteCustomCondition(this.plugin, this.customId)) this.close();
	}

	/** Ocultar o mostrar (integrada): guarda lo que haya en el diálogo con la visibilidad cambiada. */
	private async toggleHidden(): Promise<void> {
		this.draft.hidden = !this.draft.hidden;
		await this.saveBuiltin(false);
	}

	/** Las demás condiciones que se pueden elegir en este diálogo (ni ella misma ni las ocultas). */
	private others(): ConditionInfo[] {
		return allConditions(this.plugin.settings).filter((x) => x.id !== this.customId);
	}

	onOpen(): void {
		const d = this.draft;
		const builtin = this.target.kind === "builtin";
		const isNew = this.target.kind === "custom" && !this.target.cond;
		this.titleEl.setText(builtin ? T("conditionUi.editCondition", { name: d.name }) : isNew ? T("conditionUi.newCondition") : T("conditionUi.editCondition2"));
		this.modalEl.addClass("strakes-cond-modal");
		const el = this.contentEl;
		if (builtin) {
			el.createDiv({
				cls: "setting-item-description strakes-cond-builtin-note",
				text: T("conditionUi.basicRulesConditionYouCan"),
			});
		}

		new Setting(el).setName(T("conditionUi.name")).addText((t) => {
			t.setValue(d.name).onChange((v) => (d.name = v));
			window.setTimeout(() => t.inputEl.focus(), 10);
		});
		new Setting(el)
			.setName(T("conditionUi.description"))
			.setDesc(
				T("conditionUi.shownWhenYouClickThe"),
			)
			.addTextArea((t) => {
				t.setValue(d.description).onChange((v) => (d.description = v));
				t.inputEl.rows = builtin ? 10 : 6;
				t.inputEl.addClass("strakes-cond-textarea");
			});
		this.iconPicker = new IconPicker(el, {
			icon: d.icon,
			iconColor: d.color,
			background: null,
			placeholder: this.original?.icon ?? "⚠",
			reload: () => this.plugin.reloadIcons(),
			onChange: (icon) => {
				d.icon = icon;
				this.iconColor?.refresh();
			},
		});
		const colors = new Setting(el).setName(T("conditionUi.color"));
		colors.controlEl.addClass("strakes-color-row");
		this.iconColor = new IconColorControl(colors.controlEl.createDiv("strakes-color-group"), {
			label: T("conditionUi.icon"),
			getIcon: () => d.icon || this.original?.icon || "",
			color: d.color,
			defaultColor: this.original?.color ?? DEFAULT_CUSTOM_COLOR,
			onChange: (col) => {
				d.color = col;
				this.iconPicker?.setIconColor(col);
			},
		});

		// Acumulativa (como Agotamiento): cada vez que se aplica sube un nivel.
		const cumulative = new Setting(el)
			.setName(T("conditionUi.cumulative"))
			.setDesc(T("conditionUi.eachTimeItsAppliedIt"));
		let levelInput: HTMLInputElement | null = null;
		cumulative.addText((t) => {
			levelInput = t.inputEl;
			t.inputEl.type = "number";
			t.inputEl.min = "2";
			t.inputEl.max = "99";
			t.inputEl.addClass("strakes-cond-level-input");
			t.setPlaceholder(T("conditionUi.max")).setValue(d.maxLevel ? String(d.maxLevel) : "");
			t.setDisabled(!d.maxLevel);
			t.onChange((v) => {
				const n = parseInt(v, 10);
				if (!isNaN(n) && n >= 2) d.maxLevel = Math.min(99, n);
			});
			setTooltip(t.inputEl, T("conditionUi.maximumLevel"));
		});
		cumulative.addToggle((t) =>
			t.setValue(!!d.maxLevel).onChange((on) => {
				d.maxLevel = on ? (d.maxLevel ?? 6) : undefined;
				if (levelInput) {
					levelInput.disabled = !on;
					levelInput.value = on ? String(d.maxLevel) : "";
				}
			}),
		);

		// Condiciones que aplica (en cadena: si aplica Paralizado, también Incapacitado).
		new Setting(el)
			.setName(T("conditionUi.appliesConditions"))
			.setDesc(T("conditionUi.whileItHasThisCondition")).settingEl.addClass("strakes-cond-implies-setting");
		this.conditionChecks(el, d.implies, (ids) => (d.implies = ids));

		// Automatismos: los mismos para integradas y personalizadas.
		new Setting(el).setName(T("conditionUi.automations")).setHeading();
		this.rulesEl = el.createDiv("strakes-cond-rules");
		this.renderRules();

		// Pie siempre visible, como en los diálogos de los mapas. En una integrada, «Ocultar» (o «Mostrar» si
		// ya lo está) ocupa el sitio de «Eliminar», con su mismo aspecto: una integrada no se puede borrar.
		const buttons = modalFooter(this);
		if (builtin)
			buttons.addButton((b) => {
				b.setButtonText(d.hidden ? T("conditionUi.show") : T("conditionUi.hide"))
					.setDestructive()
					.setTooltip(d.hidden ? T("conditionUi.showTip") : T("conditionUi.itDoesntAppearInAny"))
					.onClick(() => void this.toggleHidden());
			});
		else if (!isNew)
			buttons.addButton((b) => b.setButtonText(T("conditionUi.delete")).setDestructive().onClick(() => void this.deleteThis()));
		if (builtin) buttons.addButton((b) => b.setButtonText(T("conditionUi.reset")).onClick(() => void this.saveBuiltin(true)));
		buttons.addButton((b) => b.setButtonText(T("conditionUi.cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("conditionUi.save"))
				.setCta()
				.onClick(() => {
					if (!d.name.trim()) {
						new Notice(T("conditionUi.giveTheConditionAName"));
						return;
					}
					void (builtin ? this.saveBuiltin(false) : this.saveCustom());
				}),
		);
	}

	/** Cuadrícula de casillas con las demás condiciones (para «aplica», «al terminar deja» y «termina si»). */
	private conditionChecks(parent: HTMLElement, selected: string[], onChange: (ids: string[]) => void): void {
		const grid = parent.createDiv("strakes-cond-implies");
		const set = new Set(selected);
		for (const info of this.others()) {
			const label = grid.createEl("label", { cls: "strakes-cond-implies-item" });
			const cb = label.createEl("input", { type: "checkbox" });
			cb.checked = set.has(info.id);
			renderConditionIcon(label.createSpan(), info);
			label.appendText(info.name);
			cb.onchange = () => {
				if (cb.checked) set.add(info.id);
				else set.delete(info.id);
				onChange([...set]);
			};
		}
	}

	/** Sección de automatismos (se repinta al añadir o quitar umbrales). */
	private renderRules(): void {
		const box = this.rulesEl;
		if (!box) return;
		box.empty();
		const r = this.draft.rules;

		// Por PG.
		new Setting(box)
			.setName(T("conditionUi.appliesAutomaticallyByHp"))
			.setDesc(T("conditionUi.whileAnyOfTheseThresholds"))
			.addExtraButton((b) =>
				b
					.setIcon("plus")
					.setTooltip(T("conditionUi.addHpThreshold"))
					.onClick(() => {
						r.hpTriggers = [...(r.hpTriggers ?? []), { threshold: "zero", who: "all" }];
						this.renderRules();
					}),
			);
		(r.hpTriggers ?? []).forEach((t, i) => {
			const row = new Setting(box).setClass("strakes-rule-row");
			row.addDropdown((dd) =>
				dd
					.addOptions({ percent: T("conditionUi.hpOfMax"), zero: T("conditionUi.hp0"), "negative-max": T("conditionUi.hpMax") })
					.setValue(t.threshold)
					.onChange((v) => {
						t.threshold = v as HpTrigger["threshold"];
						if (t.threshold === "percent") t.percent ??= 50;
						else delete t.percent;
						this.renderRules();
					}),
			);
			if (t.threshold === "percent")
				row.addText((tx) => {
					tx.inputEl.type = "number";
					tx.inputEl.min = "1";
					tx.inputEl.max = "100";
					tx.inputEl.addClass("strakes-rule-number");
					tx.setValue(String(t.percent ?? 50)).onChange((v) => {
						const n = parseInt(v, 10);
						if (n >= 1 && n <= 100) t.percent = n;
					});
				});
			row.addDropdown((dd) =>
				dd
					.addOptions({ all: T("conditionUi.everyone"), enemies: T("conditionUi.enemies"), allies: T("conditionUi.pcsAndAllies") })
					.setValue(t.who)
					.onChange((v) => (t.who = v as RuleTarget)),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip(T("conditionUi.remove"))
					.onClick(() => {
						r.hpTriggers!.splice(i, 1);
						this.renderRules();
					}),
			);
		});

		// Por nivel de otra condición acumulativa.
		const cumulative = this.others().filter((x) => x.maxLevel);
		new Setting(box)
			.setName(T("conditionUi.appliesAutomaticallyByAnothersLevel"))
			.setDesc(
				cumulative.length
					? T("conditionUi.whenAnotherCumulativeConditionReaches")
					: T("conditionUi.thereAreNoOtherCumulative"),
			)
			.addExtraButton((b) =>
				b
					.setIcon("plus")
					.setTooltip(T("conditionUi.addLevelThreshold"))
					.setDisabled(!cumulative.length)
					.onClick(() => {
						const first = cumulative[0];
						if (!first) return;
						r.levelTriggers = [...(r.levelTriggers ?? []), { conditionId: first.id, minLevel: first.maxLevel ?? 2 }];
						this.renderRules();
					}),
			);
		(r.levelTriggers ?? []).forEach((t, i) => {
			const row = new Setting(box).setClass("strakes-rule-row");
			row.addDropdown((dd) => {
				for (const info of cumulative) dd.addOption(info.id, info.name);
				// Una condición que ya no está disponible (oculta o borrada) se ve, pero no se puede elegir.
				if (!cumulative.some((x) => x.id === t.conditionId)) dd.addOption(t.conditionId, T("conditionUi.unavailable"));
				dd.setValue(t.conditionId).onChange((v) => (t.conditionId = v));
			});
			row.addText((tx) => {
				tx.inputEl.type = "number";
				tx.inputEl.min = "1";
				tx.inputEl.addClass("strakes-rule-number");
				setTooltip(tx.inputEl, T("conditionUi.fromThisLevel"));
				tx.setValue(String(t.minLevel)).onChange((v) => {
					const n = parseInt(v, 10);
					if (n >= 1) t.minLevel = n;
				});
			});
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip(T("conditionUi.remove"))
					.onClick(() => {
						r.levelTriggers!.splice(i, 1);
						this.renderRules();
					}),
			);
		});

		// Al terminar, deja…
		new Setting(box)
			.setName(T("conditionUi.whenItEndsLeaves"))
			.setDesc(T("conditionUi.whenItEndsOnIts"))
			.settingEl.addClass("strakes-cond-implies-setting");
		this.conditionChecks(box, r.leaves ?? [], (ids) => (r.leaves = ids));

		// Termina sola si…
		new Setting(box)
			.setName(T("conditionUi.endsOnItsOwnIf"))
			.setDesc(T("conditionUi.anyOfTheCheckedOnes"))
			.settingEl.addClass("strakes-cond-implies-setting");
		this.conditionChecks(box, r.endsWith ?? [], (ids) => (r.endsWith = ids));
		new Setting(box)
			.setName(T("conditionUi.endsOnItsOwnAt"))
			.addToggle((t) => t.setValue(!!r.endsAtZeroHp).onChange((v) => (r.endsAtZeroHp = v || undefined)));

		// Aviso al recibir daño.
		const save = new Setting(box)
			.setName(T("conditionUi.savingThrowWhenTakingDamage"))
			.setDesc(T("conditionUi.showsTheRollWithThe"));
		save.addText((tx) =>
			tx
				.setPlaceholder(T("conditionUi.abilityEGConstitution"))
				.setValue(r.damageSave?.ability ?? "")
				.setDisabled(!r.damageSave)
				.onChange((v) => {
					if (r.damageSave) r.damageSave.ability = v;
				}),
		);
		save.addToggle((t) =>
			t.setValue(!!r.damageSave).onChange((v) => {
				r.damageSave = v ? { ability: r.damageSave?.ability || T("conditionUi.constitution") } : undefined;
				this.renderRules();
			}),
		);

		new Setting(box)
			.setName(T("conditionUi.defeatsTheEnemy"))
			.setDesc(T("conditionUi.anEnemyWithThisCondition"))
			.addToggle((t) => t.setValue(!!r.defeats).onChange((v) => (r.defeats = v || undefined)));
		new Setting(box)
			.setName(T("conditionUi.notifyWhenAppliedOrEnded"))
			.addToggle((t) => t.setValue(!!r.announce).onChange((v) => (r.announce = v || undefined)));
		new Setting(box)
			.setName(T("conditionUi.isAConcentration"))
			.setDesc(
				T("conditionUi.itsCardLetsYouSet"),
			)
			.addToggle((t) => t.setValue(!!r.concentration).onChange((v) => (r.concentration = v || undefined)));
	}

	private async saveCustom(): Promise<void> {
		const d = this.draft;
		const rules = cleanRules(d.rules);
		const cond: CustomCondition = {
			id: this.customId,
			name: d.name.trim(),
			description: d.description,
			icon: d.icon,
			color: d.color,
			implies: d.implies.length ? d.implies : undefined,
			maxLevel: d.maxLevel,
			rules: Object.keys(rules).length ? rules : undefined,
		};
		const list = this.plugin.settings.customConditions;
		const idx = list.findIndex((x) => x.id === cond.id);
		if (idx >= 0) list[idx] = cond;
		else list.push(cond);
		await this.finish(cond.id);
	}

	/** Guarda solo lo que difiere de la condición original (o nada, si se restablece). */
	private async saveBuiltin(reset: boolean): Promise<void> {
		const o = this.original!;
		const d = this.draft;
		const overrides = this.plugin.settings.conditionOverrides;
		const ov: ConditionOverride = {};
		if (!reset) {
			const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
			if (d.name.trim() !== o.name) ov.name = d.name.trim();
			if (d.description.trim() !== o.description.trim()) ov.description = d.description;
			if (d.icon && d.icon !== o.icon) ov.icon = d.icon;
			if (d.color !== o.color) ov.color = d.color ?? null;
			if (!same(d.implies, o.implies)) ov.implies = d.implies;
			if (d.maxLevel !== o.maxLevel) ov.maxLevel = d.maxLevel ?? null;
			if (!sameRules(d.rules, o.rules)) ov.rules = cleanRules(d.rules);
			if (d.hidden) ov.hidden = true;
		}
		if (Object.keys(ov).length) overrides[o.id] = ov;
		else delete overrides[o.id];
		await this.finish(o.id);
	}

	private async finish(id: string): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.events.trigger("combat");
		// La lista de condiciones personalizadas de los ajustes se calcula al registrar la pestaña: se
		// recalcula aquí, se haya abierto el diálogo desde los ajustes o desde el menú de un combatiente.
		this.plugin.settingTab.update();
		this.onDone?.({ id });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Elimina una condición personalizada, tras confirmarlo: de la lista y de los combatientes que la
 * tengan. Devuelve true si se eliminó. Lo usan la papelera de los ajustes y el botón del diálogo.
 */
export async function deleteCustomCondition(plugin: StrakesTTRPG, id: string): Promise<boolean> {
	const s = plugin.settings;
	const cond = s.customConditions.find((x) => x.id === id);
	if (!cond) return false;
	const ok = await confirmDialog(plugin.app, T("settings.deleteCondition"), T("settings.deleteItWillAlsoBe", { name: cond.name }));
	if (!ok) return false;
	s.customConditions = s.customConditions.filter((x) => x.id !== id);
	for (const c of s.combat.combatants) c.conditions = c.conditions.filter((e) => e.id !== id);
	await plugin.saveSettings();
	plugin.events.trigger("combat");
	plugin.settingTab.update();
	return true;
}
