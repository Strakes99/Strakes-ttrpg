import { ItemView, Menu, Notice, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import type StrakesTTRPG from "../main";
import { confirmDialog } from "../ui/modals";
import { watchStatusBarGap } from "../ui/statusBarGap";
import { Combatant, InitiativeDisplay, Portrait, VIEW_TYPE_INITIATIVE } from "../types";
import { editPortrait, recalledPortrait, renderPortrait, splitName } from "./portrait";
import { closeConditionCard, renderConditionChips, showConditionMenu } from "./conditionUi";
import { parseInitiative } from "./tracker";

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
		return "Iniciativa";
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
		top.createDiv({ cls: "strakes-init-round", text: `Ronda ${this.tracker.state.round}` });
		const nav = top.createDiv("strakes-init-nav");
		this.iconButton(nav, "chevron-left", "Turno anterior", () => this.tracker.prev());
		this.iconButton(nav, "chevron-right", "Siguiente turno", () => this.tracker.next(), "mod-cta");
		this.iconButton(nav, "arrow-down-wide-narrow", "Ordenar por iniciativa", () => this.tracker.sort());
		this.iconButton(nav, "more-vertical", "Más opciones", (evt) => this.moreMenu(evt));

		const show = h.createDiv("strakes-init-show");
		show.createSpan({ text: "Jugadores:" });
		const seg = show.createDiv("strakes-segmented");
		const modes: [InitiativeDisplay, string][] = [
			["off", "Oculto"],
			["overlay", "Lista"],
			["cards", "Tarjetas"],
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
		this.iconButton(show, "monitor", "Abrir pantalla de jugadores", () => this.plugin.openPlayerScreen(true));
	}

	private moreMenu(evt: MouseEvent): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle("Reiniciar combate (ronda 1)").setIcon("rotate-ccw").onClick(() => this.tracker.restart()));
		m.addItem((i) =>
			i
				.setTitle("Quitar enemigos (conservar PJ y aliados)")
				.setIcon("user-minus")
				.onClick(() => this.tracker.clearMonsters()),
		);
		m.addItem((i) =>
			i
				.setTitle("Vaciar todo")
				.setIcon("trash-2")
				.onClick(async () => {
					if (await confirmDialog(this.app, "Vaciar iniciativa", "¿Eliminar a todos los combatientes?"))
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
			list.createDiv({ cls: "strakes-init-empty", text: "Sin combatientes. Añade algunos abajo." });
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
		row.toggleClass("is-down", !c.isPlayer && c.hp !== null && c.hp <= 0);

		const line1 = row.createDiv("strakes-init-line");
		const turn = line1.createDiv("strakes-init-turn");
		setIcon(turn, isCurrent ? "play" : "circle");
		setTooltip(turn, "Marcar como turno actual");
		turn.onclick = () => this.tracker.setCurrent(c.id);

		// Miniatura del retrato: clic para elegirlo o encuadrarlo.
		const thumb = line1.createEl("button", { cls: "strakes-init-thumb" });
		renderPortrait(this.app, thumb, c);
		setTooltip(thumb, c.portrait ? "Retrato (clic para encuadrarlo o cambiarlo)" : "Añadir retrato para el modo Tarjetas");
		thumb.onclick = () => editPortrait(this.app, c.portrait, (p) => this.tracker.setPortrait(c.id, p));

		const init = line1.createEl("input", { type: "text", cls: "strakes-init-num", value: String(c.initiative) });
		setTooltip(init, "Iniciativa (número, +mod o dados como d20+2)");
		init.onchange = () => {
			const r = parseInitiative(init.value);
			if (!r) { new Notice("Iniciativa no válida"); return; }
			if (!/^-?\d+$/.test(init.value.trim())) new Notice(`${c.name}: ${r.detail}`);
			this.tracker.update(c.id, { initiative: r.value }, true);
		};

		const name = line1.createEl("input", { type: "text", cls: "strakes-init-name", value: c.name });
		name.onchange = () => this.tracker.update(c.id, { name: name.value.trim() || c.name });

		this.iconButton(line1, "more-horizontal", "Opciones", (evt) => this.rowMenu(evt, c));

		const line2 = row.createDiv("strakes-init-line strakes-init-stats");
		// CA
		const acWrap = line2.createDiv("strakes-init-ac");
		setIcon(acWrap.createSpan("strakes-init-stat-icon"), "shield");
		const ac = acWrap.createEl("input", { type: "text", value: c.ac === null ? "" : String(c.ac), attr: { placeholder: "CA" } });
		ac.onchange = () => {
			const n = parseInt(ac.value, 10);
			this.tracker.update(c.id, { ac: isNaN(n) ? null : n });
		};

		// PV: actuales (temporales) / máximos
		const hpWrap = line2.createDiv("strakes-init-hp");
		setIcon(hpWrap.createSpan("strakes-init-stat-icon"), "heart");
		const hp = hpWrap.createEl("input", { type: "text", value: c.hp === null ? "" : String(c.hp), attr: { placeholder: "PV" } });
		setTooltip(hp, "PV actuales. También puedes escribir -5 o +3 para aplicar daño o curación");
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
			setTooltip(temp, "PV temporales: se gastan antes que los PV. Clic derecho para quitarlos");
			temp.oncontextmenu = (e) => {
				e.preventDefault();
				this.tracker.setTempHp(c.id, 0);
			};
		}
		hpWrap.createSpan({ text: "/" });
		const max = hpWrap.createEl("input", {
			type: "text",
			value: c.maxHp === null ? "" : String(c.maxHp),
			attr: { placeholder: "máx" },
		});
		max.onchange = () => {
			const n = parseInt(max.value, 10);
			this.tracker.update(c.id, { maxHp: isNaN(n) ? null : n });
		};

		// Cantidad + botones: curar (+ verde), dañar (− rojo), PV temporales (T azul).
		const amountWrap = line2.createDiv("strakes-init-amount");
		const amount = amountWrap.createEl("input", { type: "number", cls: "strakes-init-amount-input", attr: { min: "0", placeholder: "0" } });
		setTooltip(amount, "Cantidad para curar, dañar o dar PV temporales");
		const apply = (fn: (n: number) => void) => {
			const n = parseInt(amount.value, 10);
			if (isNaN(n) || n <= 0) {
				new Notice("Escribe una cantidad mayor que 0");
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
		hpButton("is-heal", "+", "Curar", (n) => this.tracker.heal(c.id, n));
		hpButton("is-damage", "−", "Dañar (se gastan antes los PV temporales)", (n) => this.tracker.damage(c.id, n));
		hpButton("is-temp", "T", "PV temporales (no se acumulan: sustituyen a los actuales)", (n) => this.tracker.setTempHp(c.id, n));

		const keyed: Record<string, HTMLInputElement> = { init, name, hp, max, ac, amount };
		for (const [k, el] of Object.entries(keyed)) el.dataset.focusKey = `${c.id}:${k}`;

		line2.createDiv("strakes-init-spacer");
		const eye = this.iconButton(line2, c.hidden ? "eye-off" : "eye", c.hidden ? "Oculto a los jugadores" : "Visible para los jugadores", () =>
			this.tracker.update(c.id, { hidden: !c.hidden }),
		);
		eye.toggleClass("is-off", c.hidden);

		// Condiciones: iconos (cursor = nombre, clic = descripción, clic derecho = quitar) y «+».
		const line3 = row.createDiv("strakes-init-line strakes-init-conds");
		renderConditionChips(line3, c, { interactive: true, plugin: this.plugin });
		const add = this.iconButton(line3, "plus", "Añadir o quitar condiciones", (evt) => showConditionMenu(evt, c, this.plugin));
		add.addClass("strakes-cond-add");
		if (!c.conditions.length) add.createSpan({ cls: "strakes-cond-add-label", text: "Condiciones" });
	}

	private rowMenu(evt: MouseEvent, c: Combatant): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle("Turno actual").setIcon("play").onClick(() => this.tracker.setCurrent(c.id)));
		m.addItem((i) =>
			i
				.setTitle(c.portrait ? "Encuadrar o cambiar retrato…" : "Añadir retrato…")
				.setIcon("image")
				.onClick(() => editPortrait(this.app, c.portrait, (p) => this.tracker.setPortrait(c.id, p))),
		);
		m.addItem((i) =>
			i
				.setTitle(c.isPlayer ? "Marcar como enemigo" : "Marcar como PJ/aliado")
				.setIcon("user")
				.onClick(() => this.tracker.update(c.id, { isPlayer: !c.isPlayer })),
		);
		m.addItem((i) =>
			i
				.setTitle(c.hidden ? "Mostrar a los jugadores" : "Ocultar a los jugadores")
				.setIcon(c.hidden ? "eye" : "eye-off")
				.onClick(() => this.tracker.update(c.id, { hidden: !c.hidden })),
		);
		m.addItem((i) =>
			i
				.setTitle("Duplicar")
				.setIcon("copy")
				.onClick(() => {
					const { id: _id, ...rest } = c;
					this.tracker.add({ ...rest, conditions: c.conditions.map((e) => ({ ...e })), name: `${c.name} (2)` });
				}),
		);
		m.addSeparator();
		m.addItem((i) => i.setTitle("Subir").setIcon("arrow-up").onClick(() => this.tracker.move(c.id, -1)));
		m.addItem((i) => i.setTitle("Bajar").setIcon("arrow-down").onClick(() => this.tracker.move(c.id, 1)));
		m.addSeparator();
		m.addItem((i) => i.setTitle("Eliminar").setIcon("trash-2").onClick(() => this.tracker.remove(c.id)));
		m.showAtMouseEvent(evt);
	}

	// ---------- Formulario para añadir ----------

	private buildAddForm(form: HTMLElement): void {
		// Título + deshacer / rehacer (solo afectan a las altas de combatientes).
		const title = form.createDiv("strakes-init-add-title");
		title.createSpan({ text: "Añadir combatiente" });
		const history = title.createDiv("strakes-init-add-history");
		const describe = (list: Combatant[]) => (list.length === 1 ? `«${list[0].name}»` : `${list.length} combatientes`);
		this.undoAddBtn = this.iconButton(history, "undo-2", "Deshacer la última alta", () => {
			const removed = this.tracker.undoAdd();
			if (removed.length) new Notice(`Deshecho: ${describe(removed)} quitado${removed.length > 1 ? "s" : ""}.`);
		});
		this.redoAddBtn = this.iconButton(history, "redo-2", "Rehacer la alta deshecha", () => {
			const restored = this.tracker.redoAdd();
			if (restored.length) new Notice(`Rehecho: ${describe(restored)} de nuevo en la iniciativa.`);
		});
		this.updateHistoryButtons();
		const r1 = form.createDiv("strakes-init-line");
		// Retrato del formulario: el elegido aquí o, si no, el último usado con ese nombre.
		let formPortrait: Portrait | undefined;
		const thumb = r1.createEl("button", { cls: "strakes-init-thumb is-form" });
		const refreshThumb = () => {
			const base = splitName(name.value.replace(/\s*[x×]\s*\d+$/i, "")).base;
			const shown = formPortrait ?? (base ? recalledPortrait(this.plugin, base) : null);
			thumb.empty();
			if (shown) {
				renderPortrait(this.app, thumb, { name: base, isPlayer: pj.checked, portrait: shown } as Combatant);
				setTooltip(thumb, formPortrait ? "Retrato elegido (clic para cambiarlo)" : `Retrato recordado para «${base}» (clic para cambiarlo)`);
			} else {
				thumb.removeClass("strakes-portrait", "is-ally", "is-enemy");
				setIcon(thumb, "image-plus");
				setTooltip(thumb, "Retrato para el modo Tarjetas");
			}
		};
		thumb.onclick = () => {
			const base = splitName(name.value.replace(/\s*[x×]\s*\d+$/i, "")).base;
			editPortrait(this.app, formPortrait ?? (base ? recalledPortrait(this.plugin, base) : null), (p) => {
				formPortrait = p ?? undefined;
				refreshThumb();
			});
		};
		const name = r1.createEl("input", { type: "text", cls: "strakes-init-name", attr: { placeholder: "Nombre (Goblin x3)" } });
		name.addEventListener("change", refreshThumb);
		const init = r1.createEl("input", { type: "text", cls: "strakes-init-num", attr: { placeholder: "Init" } });
		setTooltip(init, "Número, +mod (tira 1d20+mod) o dados (d20+2). Vacío = 1d20");
		const r2 = form.createDiv("strakes-init-line");
		// Mismo orden que en la lista de combatientes: CA y después PV.
		const ac = r2.createEl("input", { type: "text", attr: { placeholder: "CA" } });
		const hp = r2.createEl("input", { type: "text", attr: { placeholder: "PV" } });
		const pjLabel = r2.createEl("label", { cls: "strakes-init-check" });
		const pj = pjLabel.createEl("input", { type: "checkbox" });
		pjLabel.appendText("PJ/Aliado");
		const hidLabel = r2.createEl("label", { cls: "strakes-init-check" });
		const hid = hidLabel.createEl("input", { type: "checkbox" });
		hidLabel.appendText("Oculto");
		const addBtn = r2.createEl("button", { text: "Añadir", cls: "mod-cta" });
		pj.addEventListener("change", refreshThumb);
		refreshThumb();

		const submit = () => {
			let base = name.value.trim();
			if (!base) { new Notice("Escribe un nombre"); return; }
			let count = 1;
			const multi = base.match(/^(.*?)\s*[x×]\s*(\d+)$/i);
			if (multi) {
				base = multi[1];
				count = Math.min(parseInt(multi[2], 10), 30);
			}
			const hpN = parseInt(hp.value, 10);
			const acN = parseInt(ac.value, 10);
			// Validar antes de añadir nada, para no dejar un grupo a medias.
			if (!parseInitiative(init.value)) { new Notice("Iniciativa no válida"); return; }
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
					ac: isNaN(acN) ? null : acN,
					isPlayer: pj.checked,
					hidden: hid.checked,
					// Sin retrato elegido: el tracker usa el último recordado para ese nombre.
					...(formPortrait ? { portrait: { ...formPortrait } } : {}),
				});
				added.push(created);
			}
			// Todo el grupo («Goblin x3») se deshace o rehace de una vez.
			this.tracker.recordAdded(added);
			if (rolls.length) new Notice(rolls.join("\n"), 6000);
			name.value = "";
			init.value = "";
			hp.value = "";
			ac.value = "";
			// PJ/Aliado se desmarca solo tras cada alta (Oculto no, para evitar sorpresas).
			pj.checked = false;
			formPortrait = undefined;
			refreshThumb();
			name.focus();
		};
		addBtn.onclick = submit;
		for (const el of [name, init, hp, ac])
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
