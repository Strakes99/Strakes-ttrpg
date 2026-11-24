import { Ability, NumOrText, Proficiency, SKILLS, Statblock } from "./data";

/**
 * Cálculos de los statblocks (1.4). Regla general: un valor calculado se guarda vacío y se calcula al
 * dibujar; si se escribe a mano, manda lo escrito. Todo devuelve `undefined` cuando falta lo
 * necesario para calcularlo (y entonces no se dibuja nada).
 */

/** Modificador de una puntuación: (puntuación − 10) / 2, hacia abajo. */
export function abilityMod(score: number): number {
	return Math.floor((score - 10) / 2);
}

/** «+3», «−1» (con el signo menos tipográfico, como en los libros), «+0». */
export function signed(n: number): string {
	return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/** Un valor a mano: un número con signo, o el texto tal cual. */
export function signedValue(v: NumOrText): string {
	return typeof v === "number" ? signed(v) : v;
}

/** Valor numérico de un VD («1/2» → 0,5; «10» → 10). Texto que no es un VD → undefined. */
export function crValue(cr: string): number | undefined {
	const s = cr.trim().replace("½", "1/2").replace("¼", "1/4").replace("⅛", "1/8");
	const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
	if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : undefined;
	return /^\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}

/** PX por VD (tabla oficial). El VD 0 da 10 PX (0 si la criatura no tiene ataques eficaces: a mano). */
const XP_BY_CR: [number, number][] = [
	[0, 10], [0.125, 25], [0.25, 50], [0.5, 100], [1, 200], [2, 450], [3, 700], [4, 1100], [5, 1800], [6, 2300],
	[7, 2900], [8, 3900], [9, 5000], [10, 5900], [11, 7200], [12, 8400], [13, 10000], [14, 11500], [15, 13000],
	[16, 15000], [17, 18000], [18, 20000], [19, 22000], [20, 25000], [21, 33000], [22, 41000], [23, 50000],
	[24, 62000], [25, 75000], [26, 90000], [27, 105000], [28, 120000], [29, 135000], [30, 155000],
];

/** PX de la tabla para un VD, o undefined si no está en ella. */
export function xpForCr(cr: string): number | undefined {
	const v = crValue(cr);
	return v === undefined ? undefined : XP_BY_CR.find(([c]) => c === v)?.[1];
}

/** PX en la guarida (regla de 2024): los del VD siguiente. */
export function lairXpForCr(cr: string): number | undefined {
	const v = crValue(cr);
	if (v === undefined) return undefined;
	const i = XP_BY_CR.findIndex(([c]) => c === v);
	return i >= 0 && i + 1 < XP_BY_CR.length ? XP_BY_CR[i + 1][1] : undefined;
}

/** Bonificador por competencia por VD: +2 hasta 4, +3 hasta 8… +9 en 29–30. */
export function pbForCr(cr: string): number | undefined {
	const v = crValue(cr);
	if (v === undefined || v > 30) return undefined;
	return v < 5 ? 2 : Math.ceil(v / 4) + 1;
}

/** Media de una fórmula de dados («20d10 + 40» → 150; «2d8+2» → 11). Undefined si no se entiende. */
export function averageHp(formula: string): number | undefined {
	const s = formula.replace(/\s+/g, "").replace(/[−–]/g, "-");
	if (!s || !/^[+-]?(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*$/i.test(s)) return undefined;
	let total = 0;
	for (const m of s.matchAll(/([+-]?)(\d+)(?:d(\d+))?/gi)) {
		const sign = m[1] === "-" ? -1 : 1;
		const n = Number(m[2]);
		total += sign * (m[3] ? (n * (Number(m[3]) + 1)) / 2 : n);
	}
	return Math.floor(total);
}

/** Valores derivados de un statblock, ya resueltos (lo escrito a mano manda). */
export interface Derived {
	hp?: NumOrText;
	pb?: NumOrText;
	/** BC como número, si lo es (para los cálculos). */
	pbNum?: number;
	xp?: NumOrText;
	xpLair?: NumOrText;
	/** Modificador de iniciativa (número) o el texto escrito. */
	initiative?: NumOrText;
	mods: Partial<Record<Ability, number>>;
	saves: Partial<Record<Ability, NumOrText>>;
	/** Habilidades con competencia, pericia o valor escrito (o todas, con `all`). */
	skills: Record<string, NumOrText>;
	passivePerception?: NumOrText;
}

const profFactor = (p: Proficiency | undefined) => (p === "expertise" ? 2 : p === "proficient" ? 1 : 0);

/** Calcula lo derivado. Con `allSkills`, devuelve también las habilidades sin competencia. */
export function derive(sb: Statblock, allSkills = sb.all_skills): Derived {
	const pb = sb.pb ?? pbForCr(sb.cr);
	const pbNum = typeof pb === "number" ? pb : undefined;
	const mods: Partial<Record<Ability, number>> = {};
	for (const [a, score] of Object.entries(sb.scores) as [Ability, number][]) mods[a] = abilityMod(score);

	const saves: Partial<Record<Ability, NumOrText>> = {};
	for (const a of Object.keys(sb.scores) as Ability[]) {
		const m = mods[a] ?? 0;
		saves[a] = sb.save_proficiencies.includes(a) && pbNum !== undefined ? m + pbNum : m;
	}
	for (const [a, v] of Object.entries(sb.saves) as [Ability, NumOrText][]) saves[a] = v;

	const skills: Record<string, NumOrText> = {};
	for (const [skill, ability] of Object.entries(SKILLS)) {
		const manual = sb.skills[skill];
		const factor = profFactor(sb.skill_proficiencies[skill]);
		if (manual !== undefined) skills[skill] = manual;
		else if ((factor || allSkills) && mods[ability] !== undefined) skills[skill] = (mods[ability] ?? 0) + factor * (pbNum ?? 0);
	}

	let passivePerception: NumOrText | undefined = sb.passive_perception;
	if (passivePerception === undefined) {
		const perception = skills.perception ?? (sb.skill_proficiencies.perception ? undefined : mods.wis);
		if (typeof perception === "number") passivePerception = 10 + perception;
	}

	let initiative: NumOrText | undefined = sb.initiative;
	if (initiative === undefined && mods.dex !== undefined) initiative = mods.dex + profFactor(sb.initiative_proficiency) * (pbNum ?? 0);

	const xp = sb.xp ?? xpForCr(sb.cr);
	const xpLair = sb.xp_lair ?? (sb.lair ? lairXpForCr(sb.cr) : undefined);
	const hp = sb.hp ?? (sb.hp_formula ? averageHp(sb.hp_formula) : undefined);
	return { hp, pb, pbNum, xp, xpLair, initiative, mods, saves, skills, passivePerception };
}
