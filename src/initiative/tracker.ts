import { Notice } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { ActiveCondition, allConditions, combatantConditions, concentrationDC, conditionById, isDefeatedEnemy } from "./conditions";
import { CasterRef, Combatant, CombatState, ConditionEntry, EntryDuration, EntrySave, Portrait, uid } from "../types";
import { memoryKey, recalledPortrait, rememberPortrait, splitName } from "./portrait";

/**
 * Grupo en el nombre: «Goblin x3» o «Goblin ×3» → base «Goblin», cantidad 3.
 * La «x» tiene que ir separada del nombre por un espacio, para que nombres como
 * «T-Rex2» no se tomen por «T-Re» ×2. Sin grupo, la cantidad es null.
 */
export function splitGroup(text: string): { base: string; count: number | null } {
	const m = text.trim().match(/^(.+?)\s+[x×]\s*(\d+)$/i);
	return m ? { base: m[1], count: parseInt(m[2], 10) } : { base: text.trim(), count: null };
}

/**
 * Siguiente nombre numerado libre: el mayor número ya usado con la misma base, más uno.
 * Un nombre sin número cuenta como el 1 («Strahd» → «Strahd 2»). Sin distinguir mayúsculas.
 */
export function nextNumberedName(name: string, existing: readonly string[]): string {
	const base = splitName(name).base;
	const key = base.toLowerCase();
	let max = 1;
	for (const other of existing) {
		const s = splitName(other);
		if (s.base.toLowerCase() !== key) continue;
		max = Math.max(max, s.number ? parseInt(s.number, 10) : 1);
	}
	return `${base} ${max + 1}`;
}

export interface RollResult {
	value: number;
	detail: string;
}

/**
 * Interpreta la iniciativa escrita por el usuario:
 *  - "15"        → 15
 *  - "+3" / "-1" → 1d20 + modificador
 *  - "d20+2", "2d6-1" → tirada genérica
 *  - ""          → 1d20
 */
export function parseInitiative(input: string): RollResult | null {
	const s = input.replace(/\s+/g, "").toLowerCase();
	if (s === "") return roll(1, 20, 0);
	if (/^-?\d+$/.test(s)) return { value: parseInt(s, 10), detail: s };
	const mod = s.match(/^([+-]\d+)$/);
	if (mod) return roll(1, 20, parseInt(mod[1], 10));
	const dice = s.match(/^(\d*)d(\d+)([+-]\d+)?$/);
	if (dice) return roll(dice[1] ? parseInt(dice[1], 10) : 1, parseInt(dice[2], 10), dice[3] ? parseInt(dice[3], 10) : 0);
	return null;
}

function roll(count: number, sides: number, modifier: number): RollResult {
	const rolls: number[] = [];
	for (let i = 0; i < Math.min(count, 100); i++) rolls.push(1 + Math.floor(Math.random() * sides));
	const total = rolls.reduce((a, b) => a + b, 0) + modifier;
	const modTxt = modifier ? (modifier > 0 ? ` + ${modifier}` : ` − ${-modifier}`) : "";
	return { value: total, detail: `${count}d${sides} [${rolls.join(", ")}]${modTxt} = ${total}` };
}

/** Lógica del combate. Todos los cambios se guardan y emiten el evento "combat". */
export class InitiativeTracker {
	constructor(private plugin: StrakesTTRPG) {}

	get state(): CombatState {
		return this.plugin.settings.combat;
	}

	get combatants(): Combatant[] {
		return this.state.combatants;
	}

	get current(): Combatant | null {
		return this.combatants.find((c) => c.id === this.state.currentId) ?? null;
	}

	// ---------- Deshacer / rehacer altas (solo en esta sesión) ----------

	/** Grupos de combatientes añadidos de una vez (p. ej. «Goblin x3»), para deshacer/rehacer. */
	private undoAdds: Combatant[][] = [];
	private redoAdds: Combatant[][] = [];

	get canUndoAdd(): boolean {
		return this.undoAdds.length > 0;
	}

	get canRedoAdd(): boolean {
		return this.redoAdds.length > 0;
	}

	/** Registra un grupo recién añadido. Una alta nueva descarta lo que se pudiera rehacer. */
	recordAdded(group: Combatant[]): void {
		if (!group.length) return;
		this.undoAdds.push(group);
		this.redoAdds = [];
		this.changed();
	}

	/**
	 * Duplica un combatiente como uno nuevo: siguiente número libre del nombre (con Goblin 1…6,
	 * «Goblin 4» da «Goblin 7»), PG completos, CA, la misma iniciativa (queda a su lado) y si
	 * es PJ/aliado u oculto. Sin condiciones; el retrato es el recordado para ese nombre. Se
	 * puede deshacer y rehacer como cualquier alta.
	 */
	duplicate(id: string): Combatant | null {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return null;
		const hp = c.maxHp ?? c.hp;
		const copy = this.add({
			name: nextNumberedName(c.name, this.combatants.map((x) => x.name)),
			initiative: c.initiative,
			hp,
			maxHp: c.maxHp,
			ac: c.ac,
			isPlayer: c.isPlayer,
			hidden: c.hidden,
		});
		this.recordAdded([copy]);
		return copy;
	}

	/** Quita el último grupo añadido (en su estado actual, para poder rehacerlo tal cual). */
	undoAdd(): Combatant[] {
		const group = this.undoAdds.pop();
		if (!group) return [];
		const removed: Combatant[] = [];
		for (const g of group) {
			const c = this.combatants.find((x) => x.id === g.id);
			if (!c) continue;
			removed.push(structuredClone(c));
			this.removeQuiet(c.id);
		}
		if (removed.length) this.redoAdds.push(removed);
		this.changed();
		return removed;
	}

	/** Vuelve a añadir el último grupo deshecho, con los mismos datos. */
	redoAdd(): Combatant[] {
		const group = this.redoAdds.pop();
		if (!group) return [];
		const restored = group.map((g) => structuredClone(g)).filter((g) => !this.combatants.some((x) => x.id === g.id));
		this.combatants.push(...restored);
		this.sortInPlace();
		if (restored.length) this.undoAdds.push(restored);
		this.changed();
		return restored;
	}

	add(partial: Partial<Combatant> & { name: string; initiative: number }): Combatant {
		const c: Combatant = {
			id: uid(),
			hp: null,
			maxHp: null,
			tempHp: null,
			ac: null,
			isPlayer: false,
			hidden: false,
			conditions: [],
			...partial,
		};
		if (c.maxHp === null && c.hp !== null) c.maxHp = c.hp;
		// Retrato: el elegido (y se recuerda para ese nombre) o el último usado con ese nombre.
		if (c.portrait) rememberPortrait(this.plugin, c.name, c.portrait);
		else if (c.portrait === undefined) c.portrait = recalledPortrait(this.plugin, c.name);
		// Avisos de las automáticas con las que ya entra (p. ej. un PJ a 0 PG: Inconsciente).
		this.followAutoChanges(c, new Map(), true);
		this.combatants.push(c);
		this.sortInPlace();
		this.changed();
		return c;
	}

	update(id: string, patch: Partial<Combatant>, resort = false): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const oldHp = c.hp;
		const before = this.autoConditions(c);
		Object.assign(c, patch);
		// Bajar los PG a mano también es daño (avisos de tiradas de salvación).
		if ("hp" in patch && oldHp !== null && c.hp !== null && c.hp < oldHp) this.damageSaves(c, oldHp - c.hp);
		// Cambiar los PG (actuales o máximos) es un cambio natural: una automática que termina por eso deja
		// lo suyo y avisa. Cambiar de bando (PJ ↔ enemigo) no «cura» nada: no deja nada ni avisa.
		this.followAutoChanges(c, before, "hp" in patch || "maxHp" in patch);
		this.checkEndings(c);
		if (resort) this.sortInPlace();
		this.changed();
	}

	/** Cambia el retrato y lo recuerda para ese nombre (null = quitarlo y olvidarlo). */
	setPortrait(id: string, portrait: Portrait | null): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		c.portrait = portrait;
		if (portrait) rememberPortrait(this.plugin, c.name, portrait);
		else delete this.plugin.settings.portraitMemory[memoryKey(c.name)];
		this.changed();
	}

	// ---------- Puntos de golpe ----------

	/** Curación: suma PG hasta el máximo (también desde PG negativos). No afecta a los temporales. */
	heal(id: string, amount: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c || amount <= 0 || c.hp === null) return;
		const before = this.autoConditions(c);
		c.hp = c.maxHp !== null ? Math.min(c.maxHp, c.hp + amount) : c.hp + amount;
		this.followAutoChanges(c, before, true);
		// Lo que deja una automática al terminar puede acabar con otra («termina si tiene…»).
		this.checkEndings(c);
		this.changed();
	}

	/**
	 * Daño: se gasta primero de los PG temporales y el resto de los PG, que pueden quedar
	 * en negativo. Las condiciones con «aviso al recibir daño» (Concentración) avisan de su
	 * tirada de salvación por el daño total.
	 */
	damage(id: string, amount: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c || amount <= 0) return;
		const before = this.autoConditions(c);
		const fromTemp = Math.min(c.tempHp ?? 0, amount);
		if (fromTemp) c.tempHp = (c.tempHp ?? 0) - fromTemp || null;
		const rest = amount - fromTemp;
		if (rest && c.hp !== null) c.hp = c.hp - rest;
		this.damageSaves(c, amount);
		this.followAutoChanges(c, before, true);
		this.checkEndings(c);
		this.changed();
	}

	// ---------- Automatismos de las condiciones (ver ConditionRules) ----------

	/** Condiciones que el combatiente tiene ahora por sus reglas automáticas (por id). */
	private autoConditions(c: Combatant): Map<string, ActiveCondition> {
		return new Map(combatantConditions(c, this.plugin.settings).filter((a) => a.auto).map((a) => [a.info.id, a]));
	}

	/**
	 * Compara las automáticas de antes y de después de un cambio: avisa de las que se
	 * aplican o terminan (si tienen «avisar»), y las que terminan dejan sus condiciones de
	 * «al terminar, deja» (Inconsciente → Derribado). Con `natural` = false (cambio de bando),
	 * las que terminan no dejan nada ni avisan.
	 */
	private followAutoChanges(c: Combatant, before: Map<string, ActiveCondition>, natural: boolean): void {
		const after = this.autoConditions(c);
		for (const [id, a] of after)
			if (!before.has(id) && a.info.rules.announce)
				new Notice(T("tracker.autoConditionChange", { name: c.name, infoName: a.info.name, reason: a.reason ?? "" }), 6000);
		if (!natural) return;
		for (const [id, a] of before) {
			if (after.has(id)) continue;
			const left = this.leave(c, a.info.rules.leaves);
			if (a.info.rules.announce)
				new Notice(
					left.length
						? T("tracker.endsStill", { name: c.name, infoName: a.info.name, left: left.join(", ") })
						: T("tracker.ends", { name: c.name, infoName: a.info.name }),
					6000,
				);
		}
	}

	/** Añade a mano las condiciones de «al terminar, deja» que falten. Devuelve sus nombres. */
	private leave(c: Combatant, ids: string[] | undefined): string[] {
		const names: string[] = [];
		for (const id of ids ?? []) {
			const info = conditionById(id, this.plugin.settings);
			if (!info) continue;
			if (!c.conditions.some((e) => e.id === id)) c.conditions.push(info.maxLevel ? { id, level: 1 } : { id });
			names.push(info.name);
		}
		return names;
	}

	/**
	 * Avisos de «tirada de salvación al recibir daño» (Concentración): CD = máx(10, daño/2),
	 * hasta 30. No avisa si la condición va a terminar igualmente (termina a 0 PG y ya está a 0).
	 */
	private damageSaves(c: Combatant, damage: number): void {
		for (const a of combatantConditions(c, this.plugin.settings)) {
			const save = a.info.rules.damageSave;
			if (!save) continue;
			if (a.info.rules.endsAtZeroHp && c.hp !== null && c.hp <= 0) continue;
			const dc = concentrationDC(damage);
			new Notice(
				T("tracker.takesDamageDcSavingThrow", { name: c.name, damage, ability: save.ability, dc, infoName: a.info.name }),
				8000,
			);
		}
	}

	/**
	 * Condiciones que terminan solas (Concentración): a 0 PG, o si el combatiente tiene
	 * alguna de sus condiciones de «termina si aparece». Al terminar dejan las suyas.
	 */
	private checkEndings(c: Combatant): void {
		for (const e of [...c.conditions]) {
			const info = conditionById(e.id, this.plugin.settings);
			if (!info) continue;
			let reason = "";
			if (info.rules.endsAtZeroHp && c.hp !== null && c.hp <= 0) reason = T("tracker.n0Hp");
			else if (info.rules.endsWith?.length) {
				const ender = combatantConditions(c, this.plugin.settings).find((a) => a.info.id !== info.id && info.rules.endsWith!.includes(a.info.id));
				if (ender) reason = ender.info.name;
			}
			if (!reason) continue;
			c.conditions = c.conditions.filter((x) => x.id !== e.id);
			this.leave(c, info.rules.leaves);
			new Notice(T("tracker.loses", { name: c.name, infoName: info.name, reason }), 6000);
		}
	}

	/**
	 * PG temporales: no se acumulan. Los nuevos sustituyen a los que hubiera (aunque sean
	 * menos), y se avisa. 0 = quitarlos.
	 */
	setTempHp(id: string, amount: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c || amount < 0) return;
		const prev = c.tempHp ?? 0;
		c.tempHp = amount > 0 ? amount : null;
		if (prev > 0 && amount > 0)
			new Notice(T("tracker.temporaryHpDoesntStack", { name: c.name, prev, amount }), 6000);
		else if (prev > 0 && amount === 0) new Notice(T("tracker.temporaryHpRemoved", { name: c.name, prev }));
		this.changed();
	}


	// ---------- Condiciones ----------

	/**
	 * Añade una condición. Si es acumulable (Agotamiento) y ya la tiene, sube un nivel
	 * (hasta el máximo).
	 */
	addCondition(id: string, condId: string, maxLevel?: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const before = this.autoConditions(c);
		const existing = c.conditions.find((e) => e.id === condId);
		if (existing) {
			if (!maxLevel) return;
			existing.level = Math.min(maxLevel, (existing.level ?? 1) + 1);
		} else {
			c.conditions.push(maxLevel ? { id: condId, level: 1 } : { id: condId });
		}
		// Subir un nivel puede activar automáticas (Agotamiento 6 → Muerto).
		this.followAutoChanges(c, before, true);
		this.checkEndings(c);
		this.changed();
	}

	/**
	 * Quita una condición (o un nivel, si es acumulable). Al quitarla del todo deja sus
	 * condiciones de «al terminar, deja» (Inconsciente → sigue Derribado).
	 */
	removeCondition(id: string, condId: string, opts: { oneLevel?: boolean } = {}): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const idx = c.conditions.findIndex((e) => e.id === condId);
		if (idx < 0) return;
		const before = this.autoConditions(c);
		const entry = c.conditions[idx];
		if (opts.oneLevel && (entry.level ?? 1) > 1) {
			entry.level = (entry.level ?? 1) - 1;
		} else {
			c.conditions.splice(idx, 1);
			this.leave(c, conditionById(condId, this.plugin.settings)?.rules.leaves);
		}
		// Bajar un nivel puede terminar automáticas (Muerto por Agotamiento).
		this.followAutoChanges(c, before, true);
		// Lo que deja la condición quitada puede acabar con otra («termina si tiene…»).
		this.checkEndings(c);
		this.changed();
	}

	remove(id: string): void {
		this.removeQuiet(id);
		this.changed();
	}

	/** Quita un combatiente sin guardar ni avisar (si tenía el turno, pasa al siguiente). */
	private removeQuiet(id: string): void {
		const list = this.combatants;
		const idx = list.findIndex((c) => c.id === id);
		if (idx < 0) return;
		if (this.state.currentId === id) {
			const next = list[idx + 1] ?? list[0];
			this.state.currentId = next && next.id !== id ? next.id : null;
		}
		list.splice(idx, 1);
	}

	move(id: string, delta: -1 | 1): void {
		const list = this.combatants;
		const i = list.findIndex((c) => c.id === id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		this.changed();
	}

	sort(): void {
		this.sortInPlace();
		this.changed();
	}

	setCurrent(id: string): void {
		this.state.currentId = id;
		this.changed();
	}

	/** Enemigo tachado (con una condición que derrota, p. ej. Muerto): su turno se salta. Los PJ y aliados nunca se saltan. */
	private skipsTurn(c: Combatant): boolean {
		return isDefeatedEnemy(c, this.plugin.settings);
	}

	/** Siguiente turno, saltando a los enemigos tachados. Al dar la vuelta, sube la ronda. */
	next(): void {
		const list = this.combatants;
		if (!list.length) return;
		const i = list.findIndex((c) => c.id === this.state.currentId);
		// Sin turno actual: se empieza por el principio (sin contar una vuelta).
		let idx = i < 0 ? -1 : i;
		let rounds = 0;
		for (let step = 0; step < list.length; step++) {
			idx++;
			if (idx >= list.length) {
				idx = 0;
				if (i >= 0) rounds++;
			}
			if (!this.skipsTurn(list[idx])) {
				const from = this.state.currentId;
				this.state.currentId = list[idx].id;
				this.state.round += rounds;
				this.passTurn(i >= 0 ? from : null, list[idx].id, rounds);
				this.changed();
				return;
			}
		}
		// Todos son enemigos tachados: avance normal, sin saltar.
		const n = i + 1 >= list.length ? 0 : i + 1;
		const wrapped = i >= 0 && n === 0 ? 1 : 0;
		const from = this.state.currentId;
		this.state.round += wrapped;
		this.state.currentId = list[n].id;
		this.passTurn(i >= 0 ? from : null, list[n].id, wrapped);
		this.changed();
	}

	// ---------- Duraciones, lanzador y salvaciones de las condiciones aplicadas ----------

	/** Id del lanzador si es un combatiente (no un texto). */
	private casterId(e: ConditionEntry): string | null {
		return e.caster && "id" in e.caster ? e.caster.id : null;
	}

	/** Nombre del lanzador: el del combatiente o el texto. */
	casterName(e: ConditionEntry): string {
		if (!e.caster) return "";
		if ("text" in e.caster) return e.caster.text;
		return this.combatants.find((x) => x.id === (e.caster as { id: string }).id)?.name ?? T("tracker.noLongerPresent");
	}

	/**
	 * Efectos de pasar el turno con «Siguiente turno»: termina el turno de `fromId` y empieza
	 * el de `toId`; `roundsPassed` = rondas que se han completado. Termina las duraciones que
	 * tocan y avisa de las salvaciones que se repiten.
	 */
	private passTurn(fromId: string | null, toId: string, roundsPassed: number): void {
		const endings: { c: Combatant; id: string; reason: string }[] = [];
		const saves: { c: Combatant; e: ConditionEntry; s: EntrySave }[] = [];
		for (const c of this.combatants) {
			for (const e of c.conditions) {
				// Una integrada oculta en los ajustes no cuenta para nada mientras lo esté: ni avanza su
				// duración ni repite salvaciones. Si se vuelve a mostrar, sigue donde estaba.
				if (this.isHiddenCondition(e.id)) continue;
				const d = e.duration;
				if (d && d.kind !== "concentration") {
					const reason = this.tickDuration(c, e, d, fromId, toId, roundsPassed);
					if (reason) {
						endings.push({ c, id: e.id, reason });
						continue;
					}
				}
				if (e.save && ((e.save.when === "end" && fromId === c.id) || (e.save.when === "start" && toId === c.id))) saves.push({ c, e, s: e.save });
			}
		}
		for (const x of endings) this.endEntry(x.c, x.id, x.reason);
		for (const x of saves) if (x.c.conditions.includes(x.e)) this.saveNotice(x.c, x.e, x.s);
	}

	/** ¿Es una integrada que el usuario ocultó en los ajustes? (las ocultas no cuentan para nada) */
	private isHiddenCondition(id: string): boolean {
		return conditionById(id, this.plugin.settings, true)?.hidden === true;
	}

	/** Avanza una duración por turnos o rondas. Devuelve el motivo si termina ahora. */
	private tickDuration(c: Combatant, e: ConditionEntry, d: Exclude<EntryDuration, { kind: "concentration" }>, fromId: string | null, toId: string, roundsPassed: number): string | null {
		if (d.kind === "rounds") {
			const anchorAlive = d.anchorId !== null && this.combatants.some((x) => x.id === d.anchorId);
			if (anchorAlive ? toId === d.anchorId : roundsPassed > 0) d.left -= anchorAlive ? 1 : roundsPassed;
			return d.left <= 0 ? T("tracker.rounds", { count: d.rounds }) : null;
		}
		// Si el lanzador ya no está en el combate, la duración pasa a contar con el turno del afectado.
		const caster = this.casterId(e);
		const anchor = d.of === "target" || !caster || !this.combatants.some((x) => x.id === caster) ? c.id : caster;
		const whose = this.combatants.find((x) => x.id === anchor)?.name ?? "";
		if (d.kind === "turn-start") return toId === anchor ? T("tracker.startOfSTurn", { whose }) : null;
		// turn-end: termina al acabar un turno de `anchor` que empezó después de aplicarla.
		if (fromId === anchor && d.armed) return T("tracker.endOfSTurn", { whose });
		if (toId === anchor) d.armed = true;
		return null;
	}

	/** Aviso (fijo hasta pulsarlo) de una salvación que se repite: «Superada» la quita. */
	private saveNotice(c: Combatant, e: ConditionEntry, s: EntrySave): void {
		const info = conditionById(e.id, this.plugin.settings);
		if (!info) return;
		const dc = s.dc ? T("tracker.repeatSaveDc", { dc: s.dc }) : "";
		const frag = createFragment();
		frag.createDiv({ text: T("tracker.repeatsTheSave", { name: c.name, ability: s.ability, dc, condition: info.name }) });
		const buttons = frag.createDiv({ cls: "strakes-notice-buttons" });
		const notice = new Notice(frag, 0);
		const success = buttons.createEl("button", { text: T("tracker.successRemove"), cls: "mod-cta" });
		const fail = buttons.createEl("button", { text: T("tracker.failure") });
		success.onclick = (ev) => {
			ev.stopPropagation();
			notice.hide();
			// En una acumulable, superarla quita un nivel (como el clic derecho), no todos.
			if (c.conditions.includes(e)) this.removeCondition(c.id, e.id, { oneLevel: !!info.maxLevel });
		};
		fail.onclick = (ev) => {
			ev.stopPropagation();
			notice.hide();
		};
	}

	/** Termina una condición aplicada (por su duración o su concentración): deja lo suyo y avisa. */
	private endEntry(c: Combatant, condId: string, reason: string): void {
		const entry = c.conditions.find((x) => x.id === condId);
		if (!entry) return;
		const info = conditionById(condId, this.plugin.settings, true);
		const before = this.autoConditions(c);
		// Acumulable con más de un nivel (Agotamiento): baja uno y la duración ya cumplida se
		// quita; los demás niveles siguen. Para quitarlos todos, el DM lo hace a mano.
		if (info?.maxLevel && (entry.level ?? 1) > 1) {
			entry.level = (entry.level ?? 1) - 1;
			delete entry.duration;
			this.followAutoChanges(c, before, true);
			this.checkEndings(c);
			new Notice(
				T("tracker.dropsToLevel", { name: c.name, infoName: info.name, level: entry.level, reason }),
				6000,
			);
			return;
		}
		c.conditions = c.conditions.filter((x) => x.id !== condId);
		const left = this.leave(c, info?.rules.leaves);
		this.followAutoChanges(c, before, true);
		this.checkEndings(c);
		const name = info?.name ?? condId;
		new Notice(
			left.length
				? T("tracker.endsAndLeaves", { combatant: c.name, condition: name, reason, left: left.join(", ") })
				: T("tracker.endsReason", { combatant: c.name, condition: name, reason }),
			6000,
		);
	}

	/** Condición de concentración que tiene a mano un combatiente (Concentración u otra con `rules.concentration`). */
	concentrationEntry(c: Combatant): ConditionEntry | null {
		return c.conditions.find((e) => conditionById(e.id, this.plugin.settings)?.rules.concentration) ?? null;
	}

	/**
	 * Las condiciones con duración «concentración del lanzador» terminan si el lanzador ya
	 * no tiene concentración o se concentra en otro hechizo. Se comprueba en cada cambio.
	 */
	private checkConcentrationLinks(): void {
		for (const c of this.combatants) {
			for (const e of [...c.conditions]) {
				const d = e.duration;
				if (d?.kind !== "concentration" || this.isHiddenCondition(e.id)) continue;
				const caster = this.combatants.find((x) => x.id === this.casterId(e));
				const conc = caster ? this.concentrationEntry(caster) : null;
				let reason = "";
				if (!caster) reason = T("tracker.theCasterIsNoLonger");
				else if (!conc) reason = T("tracker.losesConcentration", { name: caster.name });
				else if (d.focus !== undefined && conc.focus !== d.focus) reason = T("tracker.changesSpell", { name: caster.name });
				if (reason) this.endEntry(c, e.id, reason);
			}
		}
	}

	private entry(cid: string, condId: string): { c: Combatant; e: ConditionEntry } | null {
		const c = this.combatants.find((x) => x.id === cid);
		const e = c?.conditions.find((x) => x.id === condId);
		return c && e ? { c, e } : null;
	}

	/** Asigna o quita el lanzador. Si la duración dependía de él y ya no puede, se quita (con aviso). */
	setEntryCaster(cid: string, condId: string, caster: CasterRef | null): void {
		const found = this.entry(cid, condId);
		if (!found) return;
		const { e } = found;
		if (caster) e.caster = caster;
		else delete e.caster;
		const d = e.duration;
		const needsCombatant = d && ((d.kind !== "rounds" && d.kind !== "concentration" && d.of === "caster") || d.kind === "concentration");
		if (needsCombatant && !this.casterId(e)) {
			delete e.duration;
			new Notice(T("tracker.theDurationDependedOnThe"));
		} else if (d && d.kind === "concentration") {
			// Si no se puede aplicar la Concentración al lanzador (p. ej. está oculta), se quita
			// solo la duración, como en setEntryDuration (si no, terminaría la condición entera).
			if (!this.linkConcentration(e)) delete e.duration;
		} else if (d && (d.kind === "turn-end" || d.kind === "turn-start") && d.of === "caster") {
			d.armed = false;
		}
		this.changed();
	}

	/**
	 * Asigna o quita la duración. Las de turnos empiezan sin contar el turno en curso; las de
	 * rondas se anclan a quien tiene el turno ahora; la de concentración se liga al lanzador
	 * (si no tiene Concentración, se le aplica y se avisa).
	 */
	setEntryDuration(cid: string, condId: string, duration: { kind: "turn-end" | "turn-start"; of: "target" | "caster" } | { kind: "rounds"; rounds: number } | { kind: "concentration" } | null): void {
		const found = this.entry(cid, condId);
		if (!found) return;
		const { e } = found;
		if (!duration) delete e.duration;
		else if (duration.kind === "rounds") e.duration = { kind: "rounds", rounds: duration.rounds, left: duration.rounds, anchorId: this.state.currentId };
		else if (duration.kind === "concentration") {
			e.duration = { kind: "concentration" };
			if (!this.linkConcentration(e)) delete e.duration;
		} else e.duration = { kind: duration.kind, of: duration.of, armed: false };
		this.changed();
	}

	/**
	 * Liga una condición a la concentración de su lanzador: si no tiene, se le aplica la
	 * primera condición de concentración disponible y se avisa. Devuelve false si no se pudo.
	 */
	private linkConcentration(e: ConditionEntry): boolean {
		const caster = this.combatants.find((x) => x.id === this.casterId(e));
		if (!caster || e.duration?.kind !== "concentration") return false;
		let conc = this.concentrationEntry(caster);
		if (!conc) {
			const info = allConditions(this.plugin.settings).find((x) => x.rules.concentration);
			if (!info) {
				new Notice(T("tracker.theresNoConcentrationConditionAvailable"));
				return false;
			}
			conc = { id: info.id };
			caster.conditions.push(conc);
			new Notice(T("tracker.didntHaveItHasBeen", { name: caster.name, infoName: info.name }), 6000);
		}
		e.duration.focus = conc.focus;
		return true;
	}

	/** Asigna o quita la salvación que se repite. */
	setEntrySave(cid: string, condId: string, save: EntrySave | null): void {
		const found = this.entry(cid, condId);
		if (!found) return;
		if (save) found.e.save = save;
		else delete found.e.save;
		this.changed();
	}

	/**
	 * Hechizo de una concentración. Ponerlo por primera vez no rompe nada (las condiciones
	 * ligadas toman ese nombre); cambiarlo por otro termina las ligadas a la concentración.
	 */
	setFocus(cid: string, condId: string, focus: string | null): void {
		const found = this.entry(cid, condId);
		if (!found) return;
		const old = found.e.focus;
		const next = focus?.trim() || undefined;
		if (next) found.e.focus = next;
		else delete found.e.focus;
		if (old === undefined && next !== undefined)
			for (const other of this.combatants)
				for (const e of other.conditions)
					if (e.duration?.kind === "concentration" && e.duration.focus === undefined && this.casterId(e) === cid) e.duration.focus = next;
		this.changed();
	}

	/** Turno anterior, saltando a los enemigos tachados. Al retroceder la vuelta, baja la ronda. */
	prev(): void {
		const list = this.combatants;
		if (!list.length) return;
		const i = list.findIndex((c) => c.id === this.state.currentId);
		let idx = i < 0 ? 0 : i;
		let rounds = 0;
		for (let step = 0; step < list.length; step++) {
			idx--;
			if (idx < 0) {
				idx = list.length - 1;
				if (i >= 0) rounds++;
			}
			if (!this.skipsTurn(list[idx])) {
				this.state.currentId = list[idx].id;
				this.state.round = Math.max(1, this.state.round - rounds);
				this.changed();
				return;
			}
		}
		// Todos son enemigos tachados: retroceso normal, sin saltar.
		const p = i <= 0 ? list.length - 1 : i - 1;
		if (i === 0 && this.state.round > 1) this.state.round--;
		this.state.currentId = list[p].id;
		this.changed();
	}

	/** Reinicia ronda y turno pero conserva los combatientes. */
	restart(): void {
		this.state.round = 1;
		this.state.currentId = this.combatants[0]?.id ?? null;
		this.changed();
	}

	/** Elimina a todos los enemigos (conserva PJ y aliados). */
	clearMonsters(): void {
		this.state.combatants = this.combatants.filter((c) => c.isPlayer);
		this.state.round = 1;
		this.state.currentId = null;
		this.changed();
	}

	clearAll(): void {
		this.state.combatants = [];
		this.state.round = 1;
		this.state.currentId = null;
		this.changed();
	}

	private sortInPlace(): void {
		// Orden estable: empates mantienen el orden manual.
		const indexed = this.combatants.map((c, i) => ({ c, i }));
		indexed.sort((a, b) => b.c.initiative - a.c.initiative || a.i - b.i);
		this.state.combatants = indexed.map((x) => x.c);
	}

	private changed(): void {
		this.checkConcentrationLinks();
		void this.plugin.saveSettings();
		this.plugin.events.trigger("combat");
	}
}
