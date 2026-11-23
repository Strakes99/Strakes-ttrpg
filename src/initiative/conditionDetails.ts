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
 * de la condición (clic en su icono), con los botones «Duración», «Lanzador», «Salvación» y, en las de concentración, «Hechizo».
 */

// ---------- Textos ----------

/** Duración en palabras: «hasta el final del siguiente turno de Mago», «3 rondas más»… */
function describeDuration(tracker: InitiativeTracker, c: Combatant, e: ConditionEntry): string {
	const d = e.duration;
	if (!d) return "";
	if (d.kind === "rounds")
		return T("conditionDetails.moreRounds", { count: d.left });
	if (d.kind === "concentration") {
		const spell = d.focus ? ` (${d.focus})` : "";
		return T("conditionDetails.whileKeepsConcentration", { caster: tracker.casterName(e), spell });
	}
	const who = d.of === "target" ? c.name : tracker.casterName(e);
	return d.kind === "turn-end"
		? T("conditionDetails.untilTheEndOfS", { who })
		: T("conditionDetails.untilTheStartOfS", { who });
}

/** Salvación en palabras: «Sabiduría CD 13, al final de cada turno». */
function describeSave(s: EntrySave): string {
	const dc = s.dc ? T("conditionDetails.saveDc", { dc: s.dc }) : "";
	return T(s.when === "end" ? "conditionDetails.saveAtTurnEnd" : "conditionDetails.saveAtTurnStart", { ability: s.ability, dc });
}

/** Líneas extra del tooltip del icono (duración, lanzador, salvación, hechizo). */
export function entryTooltipLines(tracker: InitiativeTracker, c: Combatant, e: ConditionEntry): string[] {
	const lines: string[] = [];
	if (e.focus) lines.push(T("conditionDetails.spell", { focus: e.focus }));
	if (e.duration) lines.push(describeDuration(tracker, c, e));
	if (e.caster) lines.push(T("conditionDetails.caster", { caster: tracker.casterName(e) }));
	if (e.save) lines.push(T("conditionDetails.save", { save: describeSave(e.save) }));
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
		setTooltip(pen, T("conditionDetails.change"));
		pen.onclick = edit;
		const x = line.createEl("button", { cls: "clickable-icon" });
		setIcon(x, "x");
		setTooltip(x, T("conditionDetails.remove"));
		x.onclick = clear;
	};
	if (info.rules.concentration)
		row(
			"sparkles",
			T("conditionDetails.spell2"),
			e.focus ? T("conditionDetails.spell", { focus: e.focus }) : "",
			() =>
				void promptText(app, T("conditionDetails.whatIsItConcentratingOn"), {
					value: e.focus ?? "",
					placeholder: T("conditionDetails.holdPerson"),
					description: T("conditionDetails.ifYouChangeSpellThe"),
				}).then((v) => {
					if (v !== null) tracker.setFocus(c.id, e.id, v);
				}),
			() => tracker.setFocus(c.id, e.id, null),
		);
	row(
		"hourglass",
		T("conditionDetails.duration"),
		e.duration ? describeDuration(tracker, c, e) : "",
		() => new DurationModal(app, plugin, c, e).open(),
		() => tracker.setEntryDuration(c.id, e.id, null),
	);
	row(
		"user",
		T("conditionDetails.caster2"),
		e.caster ? T("conditionDetails.caster", { caster: tracker.casterName(e) }) : "",
		() => pickCaster(app, plugin, (caster) => tracker.setEntryCaster(c.id, e.id, caster)),
		() => tracker.setEntryCaster(c.id, e.id, null),
	);
	row(
		"dices",
		T("conditionDetails.save2"),
		e.save ? T("conditionDetails.save", { save: describeSave(e.save) }) : "",
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
function pickCaster(app: App, plugin: StrakesTTRPG, onPick: (caster: { id: string } | { text: string }) => void): void {
	new CasterPicker(app, plugin, onPick).open();
}

class CasterPicker extends FuzzySuggestModal<CasterOption> {
	constructor(
		app: App,
		private plugin: StrakesTTRPG,
		private onPick: (caster: { id: string } | { text: string }) => void,
	) {
		super(app);
		this.setPlaceholder(T("conditionDetails.chooseTheCaster"));
	}

	getItems(): CasterOption[] {
		const state = this.plugin.tracker.state;
		const list = state.combatants.map((c): CasterOption => ({ kind: "combatant", c, current: c.id === state.currentId }));
		list.sort((a, b) => Number(b.kind === "combatant" && b.current) - Number(a.kind === "combatant" && a.current));
		return [...list, { kind: "other" }];
	}

	getItemText(o: CasterOption): string {
		return o.kind === "combatant" ? o.c.name : T("conditionDetails.other");
	}

	renderSuggestion(match: { item: CasterOption }, el: HTMLElement): void {
		const o = match.item;
		el.addClass("strakes-caster-option");
		if (o.kind === "other") {
			el.createSpan({ text: T("conditionDetails.otherTrapEnvironment") });
			return;
		}
		el.createSpan({ text: o.c.name });
		el.createSpan({ cls: `strakes-caster-tag ${o.c.isPlayer ? "is-player" : "is-enemy"}`, text: o.c.isPlayer ? T("conditionDetails.pcAlly") : T("conditionDetails.enemy") });
		if (o.current) el.createSpan({ cls: "strakes-caster-current", text: T("conditionDetails.currentTurn") });
	}

	onChooseItem(o: CasterOption): void {
		if (o.kind === "combatant") {
			this.onPick({ id: o.c.id });
			return;
		}
		void promptText(this.app, T("conditionDetails.caster2"), {
			placeholder: T("conditionDetails.cursedAltar"),
			description: T("conditionDetails.informativeOnlyItHasNo"),
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
		this.titleEl.setText(T("conditionDetails.duration"));
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		new Setting(el).setName(T("conditionDetails.ends")).addDropdown((dd) =>
			dd
				.addOptions({
					"turn-end": T("conditionDetails.atTheEndOfThe"),
					"turn-start": T("conditionDetails.atTheStartOfThe"),
					rounds: T("conditionDetails.afterANumberOfRounds"),
					concentration: T("conditionDetails.whenTheCasterLosesConcentration"),
				})
				.setValue(this.kind)
				.onChange((v) => {
					this.kind = v as DurationChoice;
					this.render();
				}),
		);
		if (this.kind === "turn-end" || this.kind === "turn-start")
			new Setting(el).setName(T("conditionDetails.turnOf")).addDropdown((dd) =>
				dd
					.addOptions({ target: T("conditionDetails.theTarget", { name: this.c.name }), caster: T("conditionDetails.theCaster") })
					.setValue(this.of)
					.onChange((v) => {
						this.of = v as "target" | "caster";
						this.render();
					}),
			);
		if (this.kind === "rounds")
			new Setting(el)
				.setName(T("conditionDetails.rounds"))
				.setDesc(
					T("conditionDetails.itEndsAtTheStart"),
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
			const caster = new Setting(el).setName(T("conditionDetails.caster2"));
			if (!this.e.caster) caster.setDesc(T("conditionDetails.noneYetChooseOne"));
			else if (!this.casterIsCombatant())
				caster.setDesc(T("conditionDetails.isntACombatantChooseOne", { caster: this.tracker.casterName(this.e) }));
			else caster.setDesc(this.tracker.casterName(this.e));
			caster.addButton((b) =>
				b.setButtonText(this.e.caster ? T("conditionDetails.change2") : T("conditionDetails.choose")).onClick(() =>
					pickCaster(this.app, this.plugin, (picked) => {
						this.tracker.setEntryCaster(this.c.id, this.e.id, picked);
						this.refreshEntry();
						this.render();
					}),
				),
			);
		}
		new Setting(el)
			.addButton((b) => b.setButtonText(T("conditionDetails.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("conditionDetails.save3"))
					.setCta()
					.onClick(() => {
						if (needsCaster && !this.casterIsCombatant()) {
							new Notice(T("conditionDetails.thisDurationNeedsACaster"));
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
		this.titleEl.setText(T("conditionDetails.savingThrow"));
		const el = this.contentEl;
		el.createEl("p", {
			cls: "setting-item-description",
			text: T("conditionDetails.repeatsTheRollOnEach", { name: this.c.name }),
		});
		new Setting(el).setName(T("conditionDetails.ability")).addText((t) => {
			t.setPlaceholder(T("conditionDetails.wisdom")).setValue(this.save.ability).onChange((v) => (this.save.ability = v));
			window.setTimeout(() => t.inputEl.focus(), 10);
		});
		new Setting(el)
			.setName(T("conditionDetails.dc"))
			.setDesc(T("conditionDetails.optional"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.inputEl.addClass("strakes-rule-number");
				t.setValue(this.save.dc ? String(this.save.dc) : "").onChange((v) => {
					const n = parseInt(v, 10);
					this.save.dc = n >= 1 ? n : undefined;
				});
			});
		new Setting(el).setName(T("conditionDetails.when")).addDropdown((dd) =>
			dd
				.addOptions({ end: T("conditionDetails.atTheEndOfEach"), start: T("conditionDetails.atTheStartOfEach") })
				.setValue(this.save.when)
				.onChange((v) => (this.save.when = v as EntrySave["when"])),
		);
		new Setting(el)
			.addButton((b) => b.setButtonText(T("conditionDetails.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(T("conditionDetails.save3"))
					.setCta()
					.onClick(() => {
						if (!this.save.ability.trim()) {
							new Notice(T("conditionDetails.enterTheAbilityForThe"));
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
