import { App, Menu, Modal, Notice, Setting, setTooltip } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { renderPinIconInto } from "../map/render";
import { Combatant, ConditionOverride, CustomCondition, uid } from "../types";
import { IconColorControl, IconPicker } from "../ui/iconPicker";
import { ActiveCondition, activeConditions, allConditions, autoReason, BUILTIN_CONDITIONS, builtinInfo, ConditionInfo, isBloodied, isDead, REMAINS_AFTER, sectionsToText } from "./conditions";

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
	/** Mostrar solo estas condiciones (p. ej. un enemigo tachado solo muestra Muerto). */
	onlyIds?: string[];
	plugin: StrakesTTRPG;
}

/**
 * Iconos de las condiciones de un combatiente. Las aplicadas por otra condición se ven
 * atenuadas. Agotamiento muestra su nivel.
 */
export function renderConditionChips(container: HTMLElement, c: Combatant, opts: ConditionChipsOptions): void {
	const all = activeConditions(c.conditions, opts.plugin.settings, { bloodied: isBloodied(c.hp, c.maxHp), dead: isDead(c) });
	const list = opts.onlyIds ? all.filter((a) => opts.onlyIds!.includes(a.info.id)) : all;
	for (const a of list) {
		const chip = container.createSpan("strakes-cond-chip");
		chip.toggleClass("is-implied", !a.explicit);
		renderConditionIcon(chip, a.info);
		if (a.level) chip.createSpan({ cls: "strakes-cond-level", text: String(a.level) });
		const title = a.level ? T(`${a.info.name} (nivel ${a.level})`, `${a.info.name} (level ${a.level})`) : a.info.name;
		setTooltip(
			chip,
			a.auto || a.autoPlaced
				? T(`${title} · automática (${autoReason(a.info.id)})`, `${title} · automatic (${autoReason(a.info.id)})`)
				: a.explicit
					? title
					: T(`${title} · aplicada por ${a.impliedBy.join(", ")}`, `${title} · applied by ${a.impliedBy.join(", ")}`),
		);
		if (!opts.interactive) continue;
		chip.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleConditionCard(chip, a);
		});
		chip.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeConditionCard();
			// Automáticas (Ensangrentado, Muerto por PG, Inconsciente puesta por el plugin): solo se avisa.
			if (a.auto || a.autoPlaced) {
				new Notice(
					T(
						`${a.info.name} es automática (${autoReason(a.info.id)}): se quita sola cuando cambian los PG.`,
						`${a.info.name} is automatic (${autoReason(a.info.id)}): it goes away on its own when HP changes.`,
					),
				);
				return;
			}
			if (!a.explicit) {
				new Notice(
					T(
						`${a.info.name} la aplica ${a.impliedBy.join(", ")}: quita esa condición para quitarla.`,
						`${a.info.name} is applied by ${a.impliedBy.join(", ")}: remove that condition to remove it.`,
					),
				);
				return;
			}
			opts.plugin.tracker.removeCondition(c.id, a.info.id, { oneLevel: !!a.info.maxLevel, remains: REMAINS_AFTER[a.info.id] });
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
function toggleConditionCard(anchor: HTMLElement, a: ActiveCondition): void {
	if (openCard?.anchor === anchor) {
		closeConditionCard();
		return;
	}
	closeConditionCard();
	const doc = anchor.doc;
	const card = doc.body.createDiv("strakes-cond-card");
	const head = card.createDiv("strakes-cond-card-head");
	renderConditionIcon(head.createSpan(), a.info);
	head.createSpan({ cls: "strakes-cond-card-title", text: a.level ? T(`${a.info.name} · nivel ${a.level}`, `${a.info.name} · level ${a.level}`) : a.info.name });
	if (a.auto || a.autoPlaced) card.createDiv({ cls: "strakes-cond-card-note", text: T(`Automática (${autoReason(a.info.id)}).`, `Automatic (${autoReason(a.info.id)}).`) });
	else if (!a.explicit)
		card.createDiv({ cls: "strakes-cond-card-note", text: T(`Aplicada por ${a.impliedBy.join(", ")}.`, `Applied by ${a.impliedBy.join(", ")}.`) });
	if (a.info.description !== undefined) {
		card.createDiv({ cls: "strakes-cond-card-text", text: a.info.description?.trim() || T("Sin descripción.", "No description.") });
	} else {
		for (const sec of a.info.sections) {
			const block = card.createDiv("strakes-cond-card-section");
			if (sec.title) block.createDiv({ cls: "strakes-cond-card-subtitle", text: sec.title });
			block.createDiv({ cls: "strakes-cond-card-text", text: sec.text });
		}
	}
	card.createDiv({
		cls: "strakes-cond-card-hint",
		text:
			a.auto || a.autoPlaced
				? T("Se quita sola cuando cambian los PG.", "It goes away on its own when HP changes.")
				: T("Clic derecho en el icono para quitarla.", "Right-click the icon to remove it."),
	});

	// Posición: debajo del icono, sin salirse de la ventana.
	const r = anchor.getBoundingClientRect();
	const win = anchor.win;
	const width = Math.min(300, win.innerWidth - 16);
	card.setCssStyles({ width: `${width}px` });
	const left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8));
	card.setCssStyles({ left: `${left}px`, top: `${r.bottom + 6}px` });
	// Si no cabe debajo, se abre encima.
	const h = card.offsetHeight;
	if (r.bottom + 6 + h > win.innerHeight - 8 && r.top - 6 - h > 8) card.setCssStyles({ top: `${r.top - 6 - h}px` });

	const onDown = (e: MouseEvent) => {
		if (!card.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeConditionCard();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") closeConditionCard();
	};
	const onScroll = () => closeConditionCard();
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
		},
	};
}

// ---------- Desplegable para añadir / quitar ----------

/** Menú con todas las condiciones: las activas, marcadas. Clic = añadir o quitar. */
export function showConditionMenu(evt: MouseEvent, c: Combatant, plugin: StrakesTTRPG): void {
	const tracker = plugin.tracker;
	const active = new Map(c.conditions.map((e) => [e.id, e]));
	const effective = activeConditions(c.conditions, plugin.settings, { bloodied: isBloodied(c.hp, c.maxHp), dead: isDead(c) });
	const implied = new Set(effective.filter((a) => !a.explicit && !a.auto).map((a) => a.info.id));
	const autoIds = new Set(effective.filter((a) => a.auto).map((a) => a.info.id));
	const m = new Menu();
	const item = (info: ConditionInfo) =>
		m.addItem((i) => {
			const entry = active.get(info.id);
			let title = info.name;
			if (info.maxLevel)
				title += entry ? T(` (nivel ${entry.level ?? 1} → ${Math.min(info.maxLevel, (entry.level ?? 1) + 1)})`, ` (level ${entry.level ?? 1} → ${Math.min(info.maxLevel, (entry.level ?? 1) + 1)})`) : "";
			else if (!entry && autoIds.has(info.id)) title += T(" (automática por PG)", " (automatic from HP)");
			else if (!entry && implied.has(info.id)) title += T(" (aplicada)", " (applied)");
			i.setTitle(title).setChecked(!!entry);
			const iconEl = (i as unknown as { iconEl?: HTMLElement }).iconEl;
			if (iconEl) {
				iconEl.empty();
				renderConditionIcon(iconEl, info);
			}
			i.onClick(() => {
				// Agotamiento: cada elección sube un nivel. Las demás: alternar.
				if (info.maxLevel || !entry) tracker.addCondition(c.id, info.id, info.maxLevel);
				else tracker.removeCondition(c.id, info.id, { remains: REMAINS_AFTER[info.id] });
			});
		});
	const all = allConditions(plugin.settings);
	for (const info of all.filter((x) => !x.custom)) item(info);
	const customs = all.filter((x) => x.custom);
	if (customs.length) {
		m.addSeparator();
		for (const info of customs) item(info);
	}
	m.addSeparator();
	m.addItem((i) =>
		i
			.setTitle(T("Nueva condición personalizada…", "New custom condition…"))
			.setIcon("plus")
			.onClick(() =>
				new ConditionModal(plugin.app, plugin, { kind: "custom", cond: null }, (created) => {
					if (created) tracker.addCondition(c.id, created.id);
				}).open(),
			),
	);
	m.showAtMouseEvent(evt);
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
}

/**
 * Crear o editar una condición: nombre, descripción, icono, color (sin fondo),
 * condiciones que aplica y si es acumulativa. Para las de las reglas básicas, los
 * cambios se guardan aparte y «Restablecer» vuelve a los originales.
 */
export class ConditionModal extends Modal {
	private draft: ConditionDraft;
	private iconPicker: IconPicker | null = null;
	private iconColor: IconColorControl | null = null;
	/** Valores originales de una condición integrada (para guardar solo lo que cambia). */
	private original: (ConditionDraft & { id: string }) | null = null;
	private customId: string;

	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private target: ConditionTarget,
		private onDone: (saved: { id: string } | null) => void,
	) {
		super(app);
		if (target.kind === "builtin") {
			const def = BUILTIN_CONDITIONS.find((b) => b.id === target.id)!;
			const base = builtinInfo(def);
			const cur = builtinInfo(def, plugin.settings.conditionOverrides[def.id]);
			this.original = {
				id: def.id,
				name: base.name,
				description: sectionsToText(base.sections),
				icon: base.icon,
				color: base.color,
				implies: [...base.implies],
				maxLevel: base.maxLevel,
			};
			this.draft = {
				name: cur.name,
				description: cur.description ?? sectionsToText(cur.sections),
				icon: cur.icon,
				color: cur.color,
				implies: [...cur.implies],
				maxLevel: cur.maxLevel,
			};
			this.customId = def.id;
		} else {
			const c = target.cond;
			this.customId = c?.id ?? `custom-${uid()}`;
			this.draft = c
				? { name: c.name, description: c.description, icon: c.icon, color: c.color, implies: [...(c.implies ?? [])], maxLevel: c.maxLevel }
				: { name: "", description: "", icon: "", color: DEFAULT_CUSTOM_COLOR, implies: [] };
		}
	}

	onOpen(): void {
		const d = this.draft;
		const builtin = this.target.kind === "builtin";
		const isNew = this.target.kind === "custom" && !this.target.cond;
		this.titleEl.setText(builtin ? T(`Editar condición: ${d.name}`, `Edit condition: ${d.name}`) : isNew ? T("Nueva condición", "New condition") : T("Editar condición", "Edit condition"));
		const el = this.contentEl;
		if (builtin)
			el.createDiv({
				cls: "setting-item-description strakes-cond-builtin-note",
				text: T(
					"Condición de las reglas básicas. Puedes cambiarla por completo para tu mesa; «Restablecer» vuelve a la original. Sus automatismos (si los tiene) se mantienen.",
					"Basic rules condition. You can fully change it for your table; \"Reset\" restores the original. Its automations (if any) are kept.",
				),
			});

		new Setting(el).setName(T("Nombre", "Name")).addText((t) => {
			t.setValue(d.name).onChange((v) => (d.name = v));
			window.setTimeout(() => t.inputEl.focus(), 10);
		});
		new Setting(el)
			.setName(T("Descripción", "Description"))
			.setDesc(T("Se muestra al hacer clic en el icono de la condición.", "Shown when you click the condition's icon."))
			.addTextArea((t) => {
				t.setValue(d.description).onChange((v) => (d.description = v));
				t.inputEl.rows = builtin ? 8 : 5;
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
		const colors = new Setting(el).setName(T("Color", "Color"));
		colors.controlEl.addClass("strakes-color-row");
		this.iconColor = new IconColorControl(colors.controlEl.createDiv("strakes-color-group"), {
			label: T("Icono", "Icon"),
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
			.setName(T("Acumulativa", "Cumulative"))
			.setDesc(T("Cada vez que se aplica sube un nivel, hasta el máximo; el clic derecho en el icono baja uno.", "Each time it's applied it goes up one level, up to the maximum; right-clicking the icon lowers it by one."));
		let levelInput: HTMLInputElement | null = null;
		cumulative.addText((t) => {
			levelInput = t.inputEl;
			t.inputEl.type = "number";
			t.inputEl.min = "2";
			t.inputEl.max = "99";
			t.inputEl.addClass("strakes-cond-level-input");
			t.setPlaceholder(T("Máx.", "Max")).setValue(d.maxLevel ? String(d.maxLevel) : "");
			t.setDisabled(!d.maxLevel);
			t.onChange((v) => {
				const n = parseInt(v, 10);
				if (!isNaN(n) && n >= 2) d.maxLevel = Math.min(99, n);
			});
			setTooltip(t.inputEl, T("Nivel máximo", "Maximum level"));
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
			.setName(T("Aplica condiciones", "Applies conditions"))
			.setDesc(T("Al tener esta condición, se aplican también las marcadas.", "While it has this condition, the checked ones also apply.")).settingEl.addClass("strakes-cond-implies-setting");
		const grid = el.createDiv("strakes-cond-implies");
		const implies = new Set(d.implies);
		for (const info of allConditions(this.plugin.settings).filter((x) => x.id !== this.customId)) {
			const label = grid.createEl("label", { cls: "strakes-cond-implies-item" });
			const cb = label.createEl("input", { type: "checkbox" });
			cb.checked = implies.has(info.id);
			renderConditionIcon(label.createSpan(), info);
			label.appendText(info.name);
			cb.onchange = () => {
				if (cb.checked) implies.add(info.id);
				else implies.delete(info.id);
				d.implies = [...implies];
			};
		}

		const buttons = new Setting(el);
		if (builtin) buttons.addButton((b) => b.setButtonText(T("Restablecer", "Reset")).onClick(() => void this.saveBuiltin(true)));
		buttons.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText(T("Guardar", "Save"))
				.setCta()
				.onClick(() => {
					if (!d.name.trim()) {
						new Notice(T("Ponle un nombre a la condición", "Give the condition a name"));
						return;
					}
					void (builtin ? this.saveBuiltin(false) : this.saveCustom());
				}),
		);
	}

	private async saveCustom(): Promise<void> {
		const d = this.draft;
		const cond: CustomCondition = {
			id: this.customId,
			name: d.name.trim(),
			description: d.description,
			icon: d.icon,
			color: d.color,
			implies: d.implies.length ? d.implies : undefined,
			maxLevel: d.maxLevel,
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
		}
		if (Object.keys(ov).length) overrides[o.id] = ov;
		else delete overrides[o.id];
		await this.finish(o.id);
	}

	private async finish(id: string): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.events.trigger("combat");
		this.onDone({ id });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
