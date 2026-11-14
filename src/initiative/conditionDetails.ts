import { App, FuzzySuggestModal, Modal, Notice, Setting, setIcon, setTooltip } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { Combatant, ConditionEntry, EntryDuration, EntrySave } from "../types";
import { promptText } from "../ui/modals";
import { ConditionInfo } from "./conditions";
import type { InitiativeTracker } from "./tracker";

/**
 * Datos de cada condición aplicada (no de la condición en general): duración, lanzador,
 * salvación que se repite y, en las de concentración, el hechizo. Se asignan desde la ficha
 * de la condición (clic en su icono), con botones «+ Duración», «+ Lanzador», «+ Salvación».
 */

// ---------- Textos ----------

/** Duración en palabras: «hasta el final del siguiente turno de Mago», «3 rondas más»… */
export function describeDuration(tracker: InitiativeTracker, c: Combatant, e: ConditionEntry): string {
	const d = e.duration;
	if (!d) return "";
	if (d.kind === "rounds")
		return d.left === 1 ? T("1 ronda más", "1 more round") : T(`${d.left} rondas más`, `${d.left} more rounds`);
	if (d.kind === "concentration") {
		const spell = d.focus ? ` (${d.focus})` : "";
		return T(`mientras ${tracker.casterName(e)} mantenga la Concentración${spell}`, `while ${tracker.casterName(e)} keeps Concentration${spell}`);
	}
	const who = d.of === "target" ? c.name : tracker.casterName(e);
	return d.kind === "turn-end"
		? T(`hasta el final del siguiente turno de ${who}`, `until the end of ${who}'s next turn`)
		: T(`hasta el inicio del siguiente turno de ${who}`, `until the start of ${who}'s next turn`);
}

/** Salvación en palabras: «Sabiduría CD 13, al final de cada turno». */
export function describeSave(s: EntrySave): string {
	const dc = s.dc ? ` CD ${s.dc}` : "";
	return s.when === "end"
		? T(`${s.ability}${dc}, al final de cada turno`, `${s.ability}${s.dc ? ` DC ${s.dc}` : ""}, at the end of each turn`)
		: T(`${s.ability}${dc}, al inicio de cada turno`, `${s.ability}${s.dc ? ` DC ${s.dc}` : ""}, at the start of each turn`);
}

/** Líneas extra del tooltip del icono (duración, lanzador, salvación, hechizo). */
export function entryTooltipLines(tracker: InitiativeTracker, c: Combatant, e: ConditionEntry): string[] {
	const lines: string[] = [];
	if (e.focus) lines.push(T(`Hechizo: ${e.focus}`, `Spell: ${e.focus}`));
	if (e.duration) lines.push(describeDuration(tracker, c, e));
	if (e.caster) lines.push(T(`Lanzador: ${tracker.casterName(e)}`, `Caster: ${tracker.casterName(e)}`));
	if (e.save) lines.push(T(`Salvación: ${describeSave(e.save)}`, `Save: ${describeSave(e.save)}`));
	return lines;
}

// ---------- Ficha: botones ----------

/** Botones de la ficha de una condición aplicada a mano. */
export function renderEntryDetails(parent: HTMLElement, plugin: StrakesTTRPG, c: Combatant, e: ConditionEntry, info: ConditionInfo): void {
	const tracker = plugin.tracker;
	const app = plugin.app;
	const box = parent.createDiv("strakes-cond-details");
	const row = (icon: string, addLabel: string, value: string, edit: () => void, clear: () => void) => {
		if (!value) {
			const b = box.createEl("button", { cls: "strakes-cond-detail-add" });
			setIcon(b.createSpan(), icon);
			b.createSpan({ text: addLabel });
			b.onclick = edit;
			return;
		}
		const line = box.createDiv("strakes-cond-detail");
		setIcon(line.createSpan("strakes-cond-detail-icon"), icon);
		line.createSpan({ cls: "strakes-cond-detail-text", text: value });
		const pen = line.createEl("button", { cls: "clickable-icon" });
		setIcon(pen, "pencil");
		setTooltip(pen, T("Cambiar", "Change"));
		pen.onclick = edit;
		const x = line.createEl("button", { cls: "clickable-icon" });
		setIcon(x, "x");
		setTooltip(x, T("Quitar", "Remove"));
		x.onclick = clear;
	};
	if (info.rules.concentration)
		row(
			"sparkles",
			T("Hechizo", "Spell"),
			e.focus ? T(`Hechizo: ${e.focus}`, `Spell: ${e.focus}`) : "",
			() =>
				void promptText(app, T("¿En qué se concentra?", "What is it concentrating on?"), {
					value: e.focus ?? "",
					placeholder: T("Inmovilizar persona", "Hold Person"),
					description: T(
						"Si cambias de hechizo, terminan las condiciones que duraban mientras se mantuviera esta concentración.",
						"If you change spell, the conditions that lasted while this concentration was kept will end.",
					),
				}).then((v) => {
					if (v !== null) tracker.setFocus(c.id, e.id, v);
				}),
			() => tracker.setFocus(c.id, e.id, null),
		);
	row(
		"hourglass",
		T("Duración", "Duration"),
		e.duration ? describeDuration(tracker, c, e) : "",
		() => new DurationModal(app, plugin, c, e).open(),
		() => tracker.setEntryDuration(c.id, e.id, null),
	);
	row(
		"user",
		T("Lanzador", "Caster"),
		e.caster ? T(`Lanzador: ${tracker.casterName(e)}`, `Caster: ${tracker.casterName(e)}`) : "",
		() => pickCaster(app, plugin, c, (caster) => tracker.setEntryCaster(c.id, e.id, caster)),
		() => tracker.setEntryCaster(c.id, e.id, null),
	);
	row(
		"dices",
		T("Salvación", "Save"),
		e.save ? T(`Salvación: ${describeSave(e.save)}`, `Save: ${describeSave(e.save)}`) : "",
		() => new SaveModal(app, plugin, c, e).open(),
		() => tracker.setEntrySave(c.id, e.id, null),
	);
}

// ---------- Elegir lanzador ----------

type CasterOption = { kind: "combatant"; c: Combatant; current: boolean } | { kind: "other" };

/**
 * Buscador de lanzador: los combatientes (quien tiene el turno, primero y marcado) y
 * «Otro…» para escribir un texto (trampa, entorno), solo informativo.
 */
export function pickCaster(app: App, plugin: StrakesTTRPG, _target: Combatant, onPick: (caster: { id: string } | { text: string }) => void): void {
	new CasterPicker(app, plugin, onPick).open();
}

class CasterPicker extends FuzzySuggestModal<CasterOption> {
	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private onPick: (caster: { id: string } | { text: string }) => void,
	) {
		super(app);
		this.setPlaceholder(T("Elige el lanzador…", "Choose the caster…"));
	}

	getItems(): CasterOption[] {
		const state = this.plugin.tracker.state;
		const list = state.combatants.map((c): CasterOption => ({ kind: "combatant", c, current: c.id === state.currentId }));
		list.sort((a, b) => Number(b.kind === "combatant" && b.current) - Number(a.kind === "combatant" && a.current));
		return [...list, { kind: "other" }];
	}

	getItemText(o: CasterOption): string {
		return o.kind === "combatant" ? o.c.name : T("Otro…", "Other…");
	}

	renderSuggestion(match: { item: CasterOption }, el: HTMLElement): void {
		const o = match.item;
		el.addClass("strakes-caster-option");
		if (o.kind === "other") {
			el.createSpan({ text: T("Otro… (trampa, entorno)", "Other… (trap, environment)") });
			return;
		}
		el.createSpan({ text: o.c.name });
		el.createSpan({ cls: `strakes-caster-tag ${o.c.isPlayer ? "is-player" : "is-enemy"}`, text: o.c.isPlayer ? T("PJ/aliado", "PC/ally") : T("Enemigo", "Enemy") });
		if (o.current) el.createSpan({ cls: "strakes-caster-current", text: T("turno actual", "current turn") });
	}

	onChooseItem(o: CasterOption): void {
		if (o.kind === "combatant") {
			this.onPick({ id: o.c.id });
			return;
		}
		void promptText(this.app, T("Lanzador", "Caster"), {
			placeholder: T("Altar maldito", "Cursed altar"),
			description: T(
				"Solo informativo: no tiene turnos ni Concentración, así que no sirve para duraciones «del lanzador».",
				"Informative only: it has no turns or Concentration, so it can't be used for \"caster\" durations.",
			),
		}).then((v) => {
			if (v && v.trim()) this.onPick({ text: v.trim() });
		});
	}
}

// ---------- Duración ----------

type DurationChoice = "turn-end" | "turn-start" | "rounds" | "concentration";

class DurationModal extends Modal {
	private kind: DurationChoice;
	private of: "target" | "caster";
	private rounds: number;

	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private c: Combatant,
		private e: ConditionEntry,
	) {
		super(app);
		const d: EntryDuration | undefined = e.duration;
		this.kind = d?.kind ?? "turn-end";
		this.of = d && (d.kind === "turn-end" || d.kind === "turn-start") ? d.of : "target";
		this.rounds = d?.kind === "rounds" ? d.rounds : 10;
	}

	private get tracker(): InitiativeTracker {
		return this.plugin.tracker;
	}

	/** ¿El lanzador actual es un combatiente (con turnos y Concentración)? */
	private casterIsCombatant(): boolean {
		return !!this.e.caster && "id" in this.e.caster;
	}

	onOpen(): void {
		this.titleEl.setText(T("Duración", "Duration"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		new Setting(el).setName(T("Termina", "Ends")).addDropdown((dd) =>
			dd
				.addOptions({
					"turn-end": T("Al final del siguiente turno", "At the end of the next turn"),
					"turn-start": T("Al inicio del siguiente turno", "At the start of the next turn"),
					rounds: T("Tras un número de rondas", "After a number of rounds"),
					concentration: T("Cuando el lanzador pierda la Concentración", "When the caster loses Concentration"),
				})
				.setValue(this.kind)
				.onChange((v) => {
					this.kind = v as DurationChoice;
					this.render();
				}),
		);
		if (this.kind === "turn-end" || this.kind === "turn-start")
			new Setting(el).setName(T("Turno de", "Turn of")).addDropdown((dd) =>
				dd
					.addOptions({ target: T(`${this.c.name} (el objetivo)`, `${this.c.name} (the target)`), caster: T("El lanzador", "The caster") })
					.setValue(this.of)
					.onChange((v) => {
						this.of = v as "target" | "caster";
						this.render();
					}),
			);
		if (this.kind === "rounds")
			new Setting(el)
				.setName(T("Rondas", "Rounds"))
				.setDesc(
					T(
						"Termina al empezar el turno de quien lo tiene ahora, tras ese número de rondas (1 minuto = 10 rondas).",
						"It ends at the start of the turn of whoever has it now, after that many rounds (1 minute = 10 rounds).",
					),
				)
				.addText((t) => {
					t.inputEl.type = "number";
					t.inputEl.min = "1";
					t.inputEl.addClass("strakes-rule-number");
					t.setValue(String(this.rounds)).onChange((v) => {
						const n = parseInt(v, 10);
						if (n >= 1) this.rounds = n;
					});
				});
		// Lanzador: necesario para «turno del lanzador» y «concentración».
		const needsCaster = this.kind === "concentration" || ((this.kind === "turn-end" || this.kind === "turn-start") && this.of === "caster");
		if (needsCaster) {
			const caster = new Setting(el).setName(T("Lanzador", "Caster"));
			if (!this.e.caster) caster.setDesc(T("Aún no tiene: elígelo.", "None yet: choose one."));
			else if (!this.casterIsCombatant())
				caster.setDesc(T(`«${this.tracker.casterName(this.e)}» no es un combatiente: elige uno.`, `"${this.tracker.casterName(this.e)}" isn't a combatant: choose one.`));
			else caster.setDesc(this.tracker.casterName(this.e));
			caster.addButton((b) =>
				b.setButtonText(this.e.caster ? T("Cambiar…", "Change…") : T("Elegir…", "Choose…")).onClick(() =>
					pickCaster(this.app, this.plugin, this.c, (picked) => {
						this.tracker.setEntryCaster(this.c.id, this.e.id, picked);
						this.refreshEntry();
						this.render();
					}),
				),
			);
		}
		new Setting(el)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("Guardar", "Save"))
					.setCta()
					.onClick(() => {
						if (needsCaster && !this.casterIsCombatant()) {
							new Notice(T("Esta duración necesita un lanzador que sea un combatiente.", "This duration needs a caster that is a combatant."));
							return;
						}
						const d =
							this.kind === "rounds"
								? { kind: "rounds" as const, rounds: this.rounds }
								: this.kind === "concentration"
									? { kind: "concentration" as const }
									: { kind: this.kind, of: this.of };
						this.tracker.setEntryDuration(this.c.id, this.e.id, d);
						this.close();
					}),
			);
	}

	/** Tras cambiar el lanzador, la entrada puede haberse sustituido en el estado: se vuelve a leer. */
	private refreshEntry(): void {
		const fresh = this.tracker.state.combatants.find((x) => x.id === this.c.id)?.conditions.find((x) => x.id === this.e.id);
		if (fresh) this.e = fresh;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- Salvación ----------

class SaveModal extends Modal {
	private save: EntrySave;

	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private c: Combatant,
		private e: ConditionEntry,
	) {
		super(app);
		this.save = e.save ? { ...e.save } : { ability: "", when: "end" };
	}

	onOpen(): void {
		this.titleEl.setText(T("Tirada de salvación", "Saving throw"));
		const el = this.contentEl;
		el.createEl("p", {
			cls: "setting-item-description",
			text: T(
				`${this.c.name} repite la tirada en cada uno de sus turnos. Aparecerá un aviso con «Superada» (quita la condición) y «Fallada».`,
				`${this.c.name} repeats the roll on each of their turns. A notice will show "Success" (removes the condition) and "Failure".`,
			),
		});
		new Setting(el).setName(T("Característica", "Ability")).addText((t) => {
			t.setPlaceholder(T("Sabiduría", "Wisdom")).setValue(this.save.ability).onChange((v) => (this.save.ability = v));
			window.setTimeout(() => t.inputEl.focus(), 10);
		});
		new Setting(el)
			.setName(T("CD", "DC"))
			.setDesc(T("Opcional.", "Optional."))
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.inputEl.addClass("strakes-rule-number");
				t.setValue(this.save.dc ? String(this.save.dc) : "").onChange((v) => {
					const n = parseInt(v, 10);
					this.save.dc = n >= 1 ? n : undefined;
				});
			});
		new Setting(el).setName(T("Cuándo", "When")).addDropdown((dd) =>
			dd
				.addOptions({ end: T("Al final de cada turno", "At the end of each turn"), start: T("Al inicio de cada turno", "At the start of each turn") })
				.setValue(this.save.when)
				.onChange((v) => (this.save.when = v as EntrySave["when"])),
		);
		new Setting(el)
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("Guardar", "Save"))
					.setCta()
					.onClick(() => {
						if (!this.save.ability.trim()) {
							new Notice(T("Escribe la característica de la tirada.", "Enter the ability for the roll."));
							return;
						}
						this.plugin.tracker.setEntrySave(this.c.id, this.e.id, { ...this.save, ability: this.save.ability.trim() });
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
