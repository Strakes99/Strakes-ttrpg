import { ItemView, Menu, Notice, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { confirmDialog } from "../ui/modals";
import { watchStatusBarGap } from "../ui/statusBarGap";
import { Combatant, InitiativeDisplay, Portrait, VIEW_TYPE_INITIATIVE } from "../types";
import { editPortrait, memoryKey, recalledPortrait, renderPortrait, splitName } from "./portrait";
import { closeConditionCard, renderConditionChips, showConditionMenu } from "./conditionUi";
import { isDefeatedEnemy } from "./conditions";
import { parseInitiative, splitGroup } from "./tracker";

/** Panel del DM para gestionar el orden de iniciativa. */
export class InitiativeView extends ItemView {
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: StrakesTTRPG) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_INITIATIVE;
	}
	getDisplayText(): string {
		return T("initiativeView.initiative");
	}
	getIcon(): string {
		return "swords";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("strakes-init");
		this.headerEl = root.createDiv("strakes-init-header");
		this.listEl = root.createDiv("strakes-init-list");
		this.buildAddForm(root.createDiv("strakes-init-add"));
		this.registerEvent(this.plugin.events.on("combat", () => this.scheduleRender()));
		this.registerEvent(this.plugin.events.on("settings", () => this.scheduleRender()));
		// Los SVG se cargan tras el arranque: redibujar los iconos de las condiciones.
		this.registerEvent(this.plugin.events.on("icons", () => this.scheduleRender()));
		this.updateGap = watchStatusBarGap(this, root);
		// Mover el panel entre la mitad superior/inferior de la barra lateral.
		this.registerEvent(this.app.workspace.on("layout-change", () => this.updateGap?.()));
		this.render();
	}

	private updateGap: (() => void) | null = null;

	onResize(): void {
		this.updateGap?.();
	}

	private get tracker() {
		return this.plugin.tracker;
	}

	private renderTimer: number | null = null;

	/**
	 * Re-renderiza en el siguiente tick: así, si el cambio vino de salir de un campo
	 * con Tab, el foco ya está en el siguiente campo y podemos restaurarlo.
	 */
	private scheduleRender(): void {
		if (this.renderTimer !== null) return;
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, 0);
	}

	async onClose(): Promise<void> {
		closeConditionCard();
	}

	private render(): void {
		// La ficha de una condición se ancla a su icono, que se va a redibujar.
		closeConditionCard();
		const active = this.contentEl.doc.activeElement as HTMLInputElement | null;
		const focusKey = active && this.listEl.contains(active) ? active.dataset.focusKey : undefined;
		const selStart = active?.selectionStart ?? null;
		const selEnd = active?.selectionEnd ?? null;
		this.renderHeader();
		this.renderList();
		this.updateHistoryButtons();
		if (focusKey) {
			const el = this.listEl.querySelector<HTMLInputElement>(`[data-focus-key="${focusKey}"]`);
			if (el) {
				el.focus();
				if (selStart !== null && selEnd !== null) el.setSelectionRange(selStart, selEnd);
			}
		}
	}

	// ---------- Cabecera ----------

	private renderHeader(): void {
		const h = this.headerEl;
		h.empty();
		const top = h.createDiv("strakes-init-top");
		top.createDiv({ cls: "strakes-init-round", text: T("initiativeView.round", { round: this.tracker.state.round }) });
		const nav = top.createDiv("strakes-init-nav");
		this.iconButton(nav, "chevron-left", T("initiativeView.previousTurn"), () => this.tracker.prev());
		this.iconButton(nav, "chevron-right", T("initiativeView.nextTurn"), () => this.tracker.next(), "mod-cta");
		this.iconButton(nav, "arrow-down-wide-narrow", T("initiativeView.sortByInitiative"), () => this.tracker.sort());
		this.iconButton(nav, "more-vertical", T("initiativeView.moreOptions"), (evt) => this.moreMenu(evt));

		const show = h.createDiv("strakes-init-show");
		show.createSpan({ text: T("initiativeView.players") });
		const seg = show.createDiv("strakes-segmented");
		const modes: [InitiativeDisplay, string][] = [
			["off", T("initiativeView.hidden")],
			["overlay", T("initiativeView.list")],
			["cards", T("initiativeView.cards")],
		];
		for (const [mode, label] of modes) {
			const b = seg.createEl("button", { text: label });
			if (this.plugin.settings.initiativeDisplay === mode) b.addClass("is-active");
			b.onclick = async () => {
				this.plugin.settings.initiativeDisplay = mode;
				if (mode !== "off") this.plugin.settings.lastInitiativeDisplay = mode;
				await this.plugin.saveSettings();
				this.plugin.events.trigger("settings");
				if (mode !== "off") await this.plugin.openPlayerScreen(false);
			};
		}
		this.iconButton(show, "monitor", T("initiativeView.openPlayerScreen"), () => this.plugin.openPlayerScreen(true));
	}

	private moreMenu(evt: MouseEvent): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle(T("initiativeView.restartCombatRound1")).setIcon("rotate-ccw").onClick(() => this.tracker.restart()));
		m.addItem((i) =>
			i
				.setTitle(T("initiativeView.removeEnemiesKeepPcsAnd"))
				.setWarning(true)
				.setIcon("user-minus")
				.onClick(() => this.tracker.clearMonsters()),
		);
		m.addItem((i) =>
			i
				.setTitle(T("initiativeView.clearAll"))
				.setWarning(true)
				.setIcon("trash-2")
				.onClick(async () => {
					if (await confirmDialog(this.app, T("initiativeView.clearInitiative"), T("initiativeView.removeAllCombatants")))
						this.tracker.clearAll();
				}),
		);
		m.showAtMouseEvent(evt);
	}

	// ---------- Lista ----------

	private renderList(): void {
		const list = this.listEl;
		list.empty();
		const combatants = this.tracker.combatants;
		if (!combatants.length) {
			list.createDiv({ cls: "strakes-init-empty", text: T("initiativeView.noCombatantsAddSomeBelow") });
			return;
		}
		for (const c of combatants) this.renderRow(list, c);
	}

	private renderRow(parent: HTMLElement, c: Combatant): void {
		const isCurrent = this.tracker.state.currentId === c.id;
		const row = parent.createDiv("strakes-init-row");
		row.toggleClass("is-current", isCurrent);
		row.toggleClass("is-player", c.isPlayer);
		row.toggleClass("is-hidden", c.hidden);
		row.toggleClass("is-down", isDefeatedEnemy(c, this.plugin.settings));

		const line1 = row.createDiv("strakes-init-line");
		const turn = line1.createDiv("strakes-init-turn");
		setIcon(turn, isCurrent ? "play" : "circle");
		setTooltip(turn, T("initiativeView.setAsCurrentTurn"));
		turn.onclick = () => this.tracker.setCurrent(c.id);

		// Miniatura del retrato: clic para elegirlo o encuadrarlo.
		const thumb = line1.createEl("button", { cls: "strakes-init-thumb" });
		renderPortrait(this.app, thumb, c);
		setTooltip(thumb, c.portrait ? T("initiativeView.portraitClickToFrameOr") : T("initiativeView.addAPortraitForCards"));
		thumb.onclick = () => editPortrait(this.app, c.portrait, (p) => this.tracker.setPortrait(c.id, p), c.name);

		const init = line1.createEl("input", { type: "text", cls: "strakes-init-num", value: String(c.initiative) });
		setTooltip(init, T("initiativeView.initiativeNumberModOrDice"));
		init.onchange = () => {
			const r = parseInitiative(init.value);
			if (!r) { new Notice(T("initiativeView.invalidInitiative")); return; }
			if (!/^-?\d+$/.test(init.value.trim())) new Notice(`${c.name}: ${r.detail}`);
			this.tracker.update(c.id, { initiative: r.value }, true);
		};

		const name = line1.createEl("input", { type: "text", cls: "strakes-init-name", value: c.name });
		name.onchange = () => this.tracker.update(c.id, { name: name.value.trim() || c.name });

		this.iconButton(line1, "more-horizontal", T("initiativeView.options"), (evt) => this.rowMenu(evt, c));

		const line2 = row.createDiv("strakes-init-line strakes-init-stats");
		// PG: actuales (temporales) / máximos
		const hpWrap = line2.createDiv("strakes-init-hp");
		setIcon(hpWrap.createSpan("strakes-init-stat-icon"), "heart");
		const hp = hpWrap.createEl("input", { type: "text", value: c.hp === null ? "" : String(c.hp), attr: { placeholder: T("initiativeView.hp") } });
		setTooltip(hp, T("initiativeView.currentHpYouCanAlso"));
		hp.onchange = () => {
			const v = hp.value.trim();
			if (v === "") return this.tracker.update(c.id, { hp: null });
			const delta = v.match(/^([+-])\s*(\d+)$/);
			if (delta && c.hp !== null) {
				const n = parseInt(delta[2], 10);
				return delta[1] === "-" ? this.tracker.damage(c.id, n) : this.tracker.heal(c.id, n);
			}
			const n = parseInt(v, 10);
			if (!isNaN(n)) this.tracker.update(c.id, { hp: n, maxHp: c.maxHp ?? n });
		};
		if (c.tempHp) {
			const temp = hpWrap.createSpan({ cls: "strakes-init-temp", text: `(${c.tempHp})` });
			setTooltip(temp, T("initiativeView.temporaryHpLostBeforeHp"));
			temp.oncontextmenu = (e) => {
				e.preventDefault();
				this.tracker.setTempHp(c.id, 0);
			};
		}
		hpWrap.createSpan({ text: "/" });
		const max = hpWrap.createEl("input", {
			type: "text",
			value: c.maxHp === null ? "" : String(c.maxHp),
			attr: { placeholder: T("initiativeView.max") },
		});
		max.onchange = () => {
			const n = parseInt(max.value, 10);
			this.tracker.update(c.id, { maxHp: isNaN(n) ? null : n });
		};

		// Cantidad + botones: curar (+ verde), dañar (− rojo), PG temporales (T azul).
		const amountWrap = line2.createDiv("strakes-init-amount");
		const amount = amountWrap.createEl("input", { type: "number", cls: "strakes-init-amount-input", attr: { min: "0", placeholder: "0" } });
		setTooltip(amount, T("initiativeView.amountToHealDamageOr"));
		const apply = (fn: (n: number) => void) => {
			const n = parseInt(amount.value, 10);
			if (isNaN(n) || n <= 0) {
				new Notice(T("initiativeView.enterAnAmountGreaterThan"));
				amount.focus();
				return;
			}
			amount.value = "";
			fn(n);
		};
		const hpButton = (cls: string, text: string, tip: string, fn: (n: number) => void) => {
			const b = amountWrap.createEl("button", { cls: `strakes-hp-btn ${cls}`, text });
			setTooltip(b, tip);
			b.onclick = () => apply(fn);
		};
		hpButton("is-heal", "+", T("initiativeView.heal"), (n) => this.tracker.heal(c.id, n));
		hpButton("is-damage", "−", T("initiativeView.damageTemporaryHpIsLost"), (n) => this.tracker.damage(c.id, n));
		hpButton("is-temp", "T", T("initiativeView.temporaryHpDoesntStackReplaces"), (n) => this.tracker.setTempHp(c.id, n));

		const keyed: Record<string, HTMLInputElement> = { init, name, hp, max, amount };
		for (const [k, el] of Object.entries(keyed)) el.dataset.focusKey = `${c.id}:${k}`;

		line2.createDiv("strakes-init-spacer");
		const eye = this.iconButton(line2, c.hidden ? "eye-off" : "eye", c.hidden ? T("initiativeView.hiddenFromPlayers") : T("initiativeView.visibleToPlayers"), () =>
			this.tracker.update(c.id, { hidden: !c.hidden }),
		);
		eye.toggleClass("is-off", c.hidden);

		// Condiciones: iconos (cursor = nombre, clic = descripción, clic derecho = quitar) y «+».
		const line3 = row.createDiv("strakes-init-line strakes-init-conds");
		renderConditionChips(line3, c, { interactive: true, plugin: this.plugin });
		const add = this.iconButton(line3, "plus", T("initiativeView.addOrRemoveConditions"), (evt) => showConditionMenu(evt, c, this.plugin));
		add.addClass("strakes-cond-add");
		if (!c.conditions.length) add.createSpan({ cls: "strakes-cond-add-label", text: T("initiativeView.conditions") });
	}

	private rowMenu(evt: MouseEvent, c: Combatant): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle(T("initiativeView.currentTurn")).setIcon("play").onClick(() => this.tracker.setCurrent(c.id)));
		m.addItem((i) =>
			i
				.setTitle(c.portrait ? T("initiativeView.frameOrChangePortrait") : T("initiativeView.addPortrait"))
				.setIcon("image")
				.onClick(() => editPortrait(this.app, c.portrait, (p) => this.tracker.setPortrait(c.id, p), c.name)),
		);
		m.addItem((i) =>
			i
				.setTitle(c.isPlayer ? T("initiativeView.markAsEnemy") : T("initiativeView.markAsPcAlly"))
				.setIcon("user")
				.onClick(() => this.tracker.update(c.id, { isPlayer: !c.isPlayer })),
		);
		m.addItem((i) =>
			i
				.setTitle(c.hidden ? T("initiativeView.showToPlayers") : T("initiativeView.hideFromPlayers"))
				.setIcon(c.hidden ? "eye" : "eye-off")
				.onClick(() => this.tracker.update(c.id, { hidden: !c.hidden })),
		);
		m.addItem((i) =>
			i
				.setTitle(T("initiativeView.duplicate"))
				.setIcon("copy")
				.onClick(() => {
					this.tracker.duplicate(c.id);
				}),
		);
		m.addSeparator();
		m.addItem((i) => i.setTitle(T("initiativeView.moveUp")).setIcon("arrow-up").onClick(() => this.tracker.move(c.id, -1)));
		m.addItem((i) => i.setTitle(T("initiativeView.moveDown")).setIcon("arrow-down").onClick(() => this.tracker.move(c.id, 1)));
		m.addSeparator();
		m.addItem((i) => i.setTitle(T("initiativeView.remove")).setWarning(true).setIcon("trash-2").onClick(() => this.tracker.remove(c.id)));
		m.showAtMouseEvent(evt);
	}

	// ---------- Formulario para añadir ----------

	private buildAddForm(form: HTMLElement): void {
		// Título + deshacer / rehacer (solo afectan a las altas de combatientes).
		const title = form.createDiv("strakes-init-add-title");
		title.createSpan({ text: T("initiativeView.addCombatant") });
		const history = title.createDiv("strakes-init-add-history");
		const describe = (list: Combatant[]) =>
			list.length === 1 ? T("initiativeView.quotedName", { name: list[0].name }) : T("initiativeView.combatants", { n: list.length });
		this.undoAddBtn = this.iconButton(history, "undo-2", T("initiativeView.undoLastAddition"), () => {
			const removed = this.tracker.undoAdd();
			if (removed.length)
				new Notice(T("initiativeView.undoneRemoved", { names: describe(removed), count: removed.length }));
		});
		this.redoAddBtn = this.iconButton(history, "redo-2", T("initiativeView.redoUndoneAddition"), () => {
			const restored = this.tracker.redoAdd();
			if (restored.length) new Notice(T("initiativeView.redoneBackInTheInitiative", { names: describe(restored) }));
		});
		this.updateHistoryButtons();
		const r1 = form.createDiv("strakes-init-line");
		// Retrato del formulario: el elegido aquí o, si no, el último usado con ese nombre.
		let formPortrait: Portrait | undefined;
		// «Quitar retrato» en el formulario: para qué nombre se quitó (clave de memoria). Mientras
		// el nombre siga siendo ese, no se usa el retrato recordado; al añadir, se olvida.
		let removedFor: string | null = null;
		const formBase = () => splitName(splitGroup(name.value).base).base;
		const removedHere = () => removedFor !== null && removedFor === memoryKey(formBase());
		const thumb = r1.createEl("button", { cls: "strakes-init-thumb" });
		const refreshThumb = () => {
			const base = formBase();
			const shown = formPortrait ?? (base && !removedHere() ? recalledPortrait(this.plugin, base) : null);
			thumb.empty();
			if (shown) {
				renderPortrait(this.app, thumb, { name: base, isPlayer: pj.checked, portrait: shown } as Combatant);
				setTooltip(
					thumb,
					formPortrait
						? T("initiativeView.chosenPortraitClickToChange")
						: T("initiativeView.rememberedPortraitForClickTo", { base }),
				);
			} else {
				thumb.removeClass("strakes-portrait", "is-ally", "is-enemy");
				setIcon(thumb, "image-plus");
				setTooltip(thumb, T("initiativeView.portraitForCardsMode"));
			}
		};
		thumb.onclick = () => {
			const base = formBase();
			editPortrait(
				this.app,
				formPortrait ?? (base && !removedHere() ? recalledPortrait(this.plugin, base) : null),
				(p) => {
					formPortrait = p ?? undefined;
					removedFor = p ? null : memoryKey(base);
					refreshThumb();
				},
				base,
			);
		};
		const name = r1.createEl("input", { type: "text", cls: "strakes-init-name", attr: { placeholder: T("initiativeView.nameGoblinX3") } });
		name.addEventListener("change", refreshThumb);
		const init = r1.createEl("input", { type: "text", cls: "strakes-init-num", attr: { placeholder: "Init" } });
		setTooltip(init, T("initiativeView.numberModRolls1d20Mod"));
		const r2 = form.createDiv("strakes-init-line");
		const hp = r2.createEl("input", { type: "text", attr: { placeholder: T("initiativeView.hp") } });
		const pjLabel = r2.createEl("label", { cls: "strakes-init-check" });
		const pj = pjLabel.createEl("input", { type: "checkbox" });
		pjLabel.appendText(T("initiativeView.pcAlly"));
		const hidLabel = r2.createEl("label", { cls: "strakes-init-check" });
		const hid = hidLabel.createEl("input", { type: "checkbox" });
		hidLabel.appendText(T("initiativeView.hidden"));
		const addBtn = r2.createEl("button", { text: T("initiativeView.add"), cls: "mod-cta" });
		pj.addEventListener("change", refreshThumb);
		refreshThumb();

		const submit = () => {
			if (!name.value.trim()) { new Notice(T("initiativeView.enterAName")); return; }
			const group = splitGroup(name.value);
			const base = group.base;
			// «Goblin x0»: avisar y no tocar el formulario (antes no añadía nada y lo vaciaba).
			if (group.count === 0) {
				new Notice(T("initiativeView.aGroupNeedsAtLeast"));
				return;
			}
			const count = group.count === null ? 1 : Math.min(group.count, 30);
			const hpN = parseInt(hp.value, 10);
			// Validar antes de añadir nada, para no dejar un grupo a medias.
			if (!parseInitiative(init.value)) { new Notice(T("initiativeView.invalidInitiative")); return; }
			const rolls: string[] = [];
			const added: Combatant[] = [];
			for (let k = 1; k <= count; k++) {
				const r = parseInitiative(init.value)!;
				if (!/^-?\d+$/.test(init.value.trim())) rolls.push(`${count > 1 ? `${base} ${k}` : base}: ${r.detail}`);
				const created = this.tracker.add({
					name: count > 1 ? `${base} ${k}` : base,
					initiative: r.value,
					hp: isNaN(hpN) ? null : hpN,
					maxHp: isNaN(hpN) ? null : hpN,
					isPlayer: pj.checked,
					hidden: hid.checked,
					// Sin retrato elegido: el tracker usa el último recordado para ese nombre,
					// salvo que se haya quitado en el formulario (null = sin retrato).
					...(formPortrait ? { portrait: { ...formPortrait } } : removedHere() ? { portrait: null } : {}),
				});
				added.push(created);
			}
			// Retrato quitado en el formulario: se olvida también el recordado para ese nombre
			// (como al quitarlo desde una fila).
			if (removedHere()) delete this.plugin.settings.portraitMemory[memoryKey(base)];
			// Todo el grupo («Goblin x3») se deshace o rehace de una vez.
			this.tracker.recordAdded(added);
			if (rolls.length) new Notice(rolls.join("\n"), 6000);
			name.value = "";
			init.value = "";
			hp.value = "";
			// PJ/Aliado se desmarca solo tras cada alta (Oculto no, para evitar sorpresas).
			pj.checked = false;
			formPortrait = undefined;
			removedFor = null;
			refreshThumb();
			name.focus();
		};
		addBtn.onclick = submit;
		for (const el of [name, init, hp])
			el.addEventListener("keydown", (e) => {
				if (e.key === "Enter") submit();
			});
	}

	private undoAddBtn: HTMLElement | null = null;
	private redoAddBtn: HTMLElement | null = null;

	/** Activa o desactiva deshacer/rehacer según haya algo que deshacer o rehacer. */
	private updateHistoryButtons(): void {
		const set = (b: HTMLElement | null, on: boolean) => {
			if (!b) return;
			b.toggleClass("is-disabled", !on);
			(b as HTMLButtonElement).disabled = !on;
		};
		set(this.undoAddBtn, this.tracker.canUndoAdd);
		set(this.redoAddBtn, this.tracker.canRedoAdd);
	}

	private iconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: (evt: MouseEvent) => unknown, cls = ""): HTMLElement {
		const b = parent.createEl("button", { cls: `clickable-icon strakes-icon-btn ${cls}` });
		setIcon(b, icon);
		setTooltip(b, tooltip);
		b.onclick = (evt) => void onClick(evt);
		return b;
	}
}
