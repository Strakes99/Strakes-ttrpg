import { Notice } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { activeConditions, CONCENTRATION_ID, concentrationDC, INCAPACITATED_ID, isDefeatedEnemy, REMAINS_AFTER, UNCONSCIOUS_ID } from "./conditions";
import { Combatant, CombatState, Portrait, uid } from "../types";
import { memoryKey, recalledPortrait, rememberPortrait } from "./portrait";

/**
 * Grupo en el nombre: «Goblin x3» o «Goblin ×3» → base «Goblin», cantidad 3.
 * La «x» tiene que ir separada del nombre por un espacio, para que nombres como
 * «T-Rex2» no se tomen por «T-Re» ×2. Sin grupo, la cantidad es null.
 */
export function splitGroup(text: string): { base: string; count: number | null } {
	const m = text.trim().match(/^(.+?)\s+[x×]\s*(\d+)$/i);
	return m ? { base: m[1], count: parseInt(m[2], 10) } : { base: text.trim(), count: null };
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
		this.syncUnconscious(c);
		this.combatants.push(c);
		this.sortInPlace();
		this.changed();
		return c;
	}

	update(id: string, patch: Partial<Combatant>, resort = false): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const oldHp = c.hp;
		Object.assign(c, patch);
		// Concentración y daño: tirada de Constitución con CD = máx(10, daño/2), hasta 30.
		if ("hp" in patch && oldHp !== null && c.hp !== null && c.hp < oldHp && this.hasConcentration(c) && c.hp > 0) {
			const damage = oldHp - c.hp;
			new Notice(
				T(
					`${c.name} recibe ${damage} de daño: tirada de salvación de Constitución CD ${concentrationDC(damage)} para mantener la Concentración.`,
					`${c.name} takes ${damage} damage: DC ${concentrationDC(damage)} Constitution saving throw to maintain Concentration.`,
				),
				8000,
			);
		}
		this.syncUnconscious(c);
		this.checkConcentration(c);
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
		c.hp = c.maxHp !== null ? Math.min(c.maxHp, c.hp + amount) : c.hp + amount;
		this.syncUnconscious(c);
		this.changed();
	}

	/**
	 * Daño: se gasta primero de los PG temporales y el resto de los PG, que pueden quedar
	 * en negativo. Con Concentración, avisa de la tirada de Constitución por el daño total.
	 */
	damage(id: string, amount: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c || amount <= 0) return;
		const fromTemp = Math.min(c.tempHp ?? 0, amount);
		if (fromTemp) c.tempHp = (c.tempHp ?? 0) - fromTemp || null;
		const rest = amount - fromTemp;
		if (rest && c.hp !== null) c.hp = c.hp - rest;
		if (this.hasConcentration(c) && (c.hp === null || c.hp > 0))
			new Notice(
				T(
					`${c.name} recibe ${amount} de daño: tirada de salvación de Constitución CD ${concentrationDC(amount)} para mantener la Concentración.`,
					`${c.name} takes ${amount} damage: DC ${concentrationDC(amount)} Constitution saving throw to maintain Concentration.`,
				),
				8000,
			);
		this.syncUnconscious(c);
		this.checkConcentration(c);
		this.changed();
	}

	/**
	 * PJ y aliados: a 0 PG o menos quedan Inconscientes (se añade sola). Al subir de 0 se
	 * quita esa Inconsciente automática y, como dice la regla, siguen Derribados.
	 * Una Inconsciente añadida a mano (p. ej. por un conjuro) no se toca.
	 */
	private syncUnconscious(c: Combatant): void {
		const autoIdx = c.conditions.findIndex((e) => e.id === UNCONSCIOUS_ID && e.auto);
		const down = c.isPlayer && c.hp !== null && c.hp <= 0;
		if (down && !c.conditions.some((e) => e.id === UNCONSCIOUS_ID)) {
			c.conditions.push({ id: UNCONSCIOUS_ID, auto: true });
			new Notice(T(`${c.name} cae a ${c.hp} PG: queda Inconsciente.`, `${c.name} drops to ${c.hp} HP and falls Unconscious.`), 6000);
		} else if (!down && autoIdx >= 0) {
			c.conditions.splice(autoIdx, 1);
			// Si dejó de ser PJ/aliado no es que recupere la consciencia: solo se quita.
			if (c.isPlayer) {
				for (const r of REMAINS_AFTER[UNCONSCIOUS_ID] ?? []) if (!c.conditions.some((e) => e.id === r)) c.conditions.push({ id: r });
				new Notice(T(`${c.name} recupera la consciencia (sigue Derribado).`, `${c.name} regains consciousness (still Prone).`), 6000);
			}
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
			new Notice(T(`${c.name}: los PG temporales no se acumulan. ${prev} → ${amount}.`, `${c.name}: temporary HP doesn't stack. ${prev} → ${amount}.`), 6000);
		else if (prev > 0 && amount === 0) new Notice(T(`${c.name}: PG temporales quitados (${prev}).`, `${c.name}: temporary HP removed (${prev}).`));
		this.changed();
	}

	private hasConcentration(c: Combatant): boolean {
		return c.conditions.some((e) => e.id === CONCENTRATION_ID);
	}

	/** La Concentración termina si el combatiente queda Incapacitado o a 0 PG. */
	private checkConcentration(c: Combatant): void {
		if (!this.hasConcentration(c)) return;
		let reason = "";
		if (c.hp !== null && c.hp <= 0) reason = T("0 PG", "0 HP");
		else if (activeConditions(c.conditions, this.plugin.settings).some((a) => a.info.id === INCAPACITATED_ID)) reason = T("Incapacitado", "Incapacitated");
		if (!reason) return;
		c.conditions = c.conditions.filter((e) => e.id !== CONCENTRATION_ID);
		new Notice(T(`${c.name} pierde la Concentración (${reason}).`, `${c.name} loses Concentration (${reason}).`), 6000);
	}

	// ---------- Condiciones ----------

	/**
	 * Añade una condición. Si es acumulable (Agotamiento) y ya la tiene, sube un nivel
	 * (hasta el máximo).
	 */
	addCondition(id: string, condId: string, maxLevel?: number): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const existing = c.conditions.find((e) => e.id === condId);
		if (existing) {
			if (!maxLevel) return;
			existing.level = Math.min(maxLevel, (existing.level ?? 1) + 1);
		} else {
			c.conditions.push(maxLevel ? { id: condId, level: 1 } : { id: condId });
		}
		this.checkConcentration(c);
		this.changed();
	}

	/**
	 * Quita una condición (o un nivel, si es acumulable). `remains`: condiciones que
	 * quedan al terminar esta (Inconsciente → sigues Derribado).
	 */
	removeCondition(id: string, condId: string, opts: { oneLevel?: boolean; remains?: string[] } = {}): void {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const idx = c.conditions.findIndex((e) => e.id === condId);
		if (idx < 0) return;
		const entry = c.conditions[idx];
		if (opts.oneLevel && (entry.level ?? 1) > 1) {
			entry.level = (entry.level ?? 1) - 1;
		} else {
			c.conditions.splice(idx, 1);
			for (const r of opts.remains ?? []) if (!c.conditions.some((e) => e.id === r)) c.conditions.push({ id: r });
		}
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

	/** Enemigo tachado (0 PG o menos): su turno se salta. Los PJ y aliados nunca se saltan. */
	private skipsTurn(c: Combatant): boolean {
		return isDefeatedEnemy(c);
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
				this.state.currentId = list[idx].id;
				this.state.round += rounds;
				this.changed();
				return;
			}
		}
		// Todos son enemigos tachados: avance normal, sin saltar.
		const n = i + 1 >= list.length ? 0 : i + 1;
		if (i >= 0 && n === 0) this.state.round++;
		this.state.currentId = list[n].id;
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
		void this.plugin.saveSettings();
		this.plugin.events.trigger("combat");
	}
}
