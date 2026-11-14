// Duración, lanzador, salvación y concentración de las condiciones aplicadas.
import { InitiativeTracker } from "../src/initiative/tracker";
import { Combatant } from "../src/types";
import { clearNotices, fakePlugin, notices, t } from "./helpers";

// Los avisos con botones usan createFragment (global de Obsidian): un sustituto mínimo que
// junta el texto y guarda los botones para poder pulsarlos.
interface FakeEl { textContent: string; onclick?: (ev: { stopPropagation(): void }) => void; createDiv(o?: { text?: string }): FakeEl; createEl(tag: string, o?: { text?: string }): FakeEl }
const buttons: FakeEl[] = [];
function fakeEl(root?: FakeEl): FakeEl {
	const el: FakeEl = {
		textContent: "",
		createDiv(o) {
			const child = fakeEl(root ?? el);
			if (o?.text) (root ?? el).textContent += o.text;
			return child;
		},
		createEl(_tag, o) {
			const child = fakeEl(root ?? el);
			child.textContent = o?.text ?? "";
			buttons.push(child);
			return child;
		},
	};
	return el;
}
(globalThis as Record<string, unknown>).createFragment = () => fakeEl();
const press = (label: string) => buttons.filter((b) => b.textContent === label).pop()?.onclick?.({ stopPropagation: () => {} });

function combat(): { tr: InitiativeTracker; mage: Combatant; orc: Combatant; goblin: Combatant } {
	const tr = new InitiativeTracker(fakePlugin());
	// Orden por iniciativa: Mago (20), Orco (15), Goblin (10).
	const mage = tr.add({ name: "Mago", initiative: 20, hp: 20, maxHp: 20, isPlayer: true });
	const orc = tr.add({ name: "Orco", initiative: 15, hp: 15, maxHp: 15 });
	const goblin = tr.add({ name: "Goblin", initiative: 10, hp: 7, maxHp: 7 });
	return { tr, mage, orc, goblin };
}
const has = (c: Combatant, id: string) => c.conditions.some((e) => e.id === id);

// ---------- Hasta el final del siguiente turno del objetivo ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id); // turno del Mago: aplica Aturdido al Orco
	tr.addCondition(orc.id, "stunned");
	tr.setEntryDuration(orc.id, "stunned", { kind: "turn-end", of: "target" });
	tr.next(); // empieza el turno del Orco
	t("fin del turno del objetivo: sigue durante su turno", has(orc, "stunned"), true);
	clearNotices();
	tr.next(); // termina el turno del Orco
	t("fin del turno del objetivo: termina al acabar su siguiente turno", has(orc, "stunned"), false);
	t("aviso al terminar", notices().some((n) => n.includes("termina Aturdido") && n.includes("final del turno de Orco")), true);
}
// Aplicada durante el turno del propio objetivo: ese turno no cuenta.
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(orc.id);
	tr.addCondition(orc.id, "stunned");
	tr.setEntryDuration(orc.id, "stunned", { kind: "turn-end", of: "target" });
	tr.next(); // termina el turno en curso del Orco: no cuenta
	t("aplicada en su propio turno: el turno en curso no cuenta", has(orc, "stunned"), true);
	tr.next(); // Mago
	tr.next(); // empieza el siguiente turno del Orco
	tr.next(); // y termina
	t("aplicada en su propio turno: termina al acabar el siguiente", has(orc, "stunned"), false);
	void mage;
}

// ---------- Del lanzador ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntryCaster(orc.id, "frightened", { id: mage.id });
	tr.setEntryDuration(orc.id, "frightened", { kind: "turn-end", of: "caster" });
	tr.next(); // Orco
	tr.next(); // Goblin
	tr.next(); // empieza el siguiente turno del Mago
	t("fin del turno del lanzador: sigue durante su turno", has(orc, "frightened"), true);
	tr.next(); // termina el turno del Mago
	t("fin del turno del lanzador: termina al acabar su siguiente turno", has(orc, "frightened"), false);
}
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "prone");
	tr.setEntryCaster(orc.id, "prone", { id: mage.id });
	tr.setEntryDuration(orc.id, "prone", { kind: "turn-start", of: "caster" });
	tr.next();
	tr.next();
	t("inicio del turno del lanzador: sigue antes", has(orc, "prone"), true);
	tr.next(); // empieza el turno del Mago
	t("inicio del turno del lanzador: termina al empezar", has(orc, "prone"), false);
}
// Lanzador de texto: no sirve para duraciones «del lanzador».
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntryCaster(orc.id, "frightened", { id: mage.id });
	tr.setEntryDuration(orc.id, "frightened", { kind: "turn-end", of: "caster" });
	tr.setEntryCaster(orc.id, "frightened", { text: "Altar maldito" });
	const e = orc.conditions.find((x) => x.id === "frightened");
	t("lanzador de texto: se guarda", e?.caster, { text: "Altar maldito" });
	t("lanzador de texto: la duración del lanzador se quita", e?.duration, undefined);
	t("nombre del lanzador de texto", e ? tr.casterName(e) : "", "Altar maldito");
}

// ---------- Rondas ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "poisoned");
	tr.setEntryDuration(orc.id, "poisoned", { kind: "rounds", rounds: 2 });
	const left = () => {
		const d = orc.conditions.find((x) => x.id === "poisoned")?.duration;
		return d?.kind === "rounds" ? d.left : null;
	};
	t("rondas: empieza con 2", left(), 2);
	tr.next();
	tr.next();
	tr.next(); // empieza el turno del Mago: 1 ronda
	t("rondas: queda 1 al volver el turno del Mago", left(), 1);
	tr.next();
	tr.next();
	tr.next(); // segunda vuelta: termina
	t("rondas: termina al empezar el turno del Mago 2 rondas después", has(orc, "poisoned"), false);
}
// Sin turno actual: cuenta por cambios de ronda.
{
	const { tr, orc } = combat();
	tr.addCondition(orc.id, "poisoned");
	tr.setEntryDuration(orc.id, "poisoned", { kind: "rounds", rounds: 1 });
	tr.next(); // empieza el combate (no es cambio de ronda)
	t("rondas sin turno: sigue al empezar", has(orc, "poisoned"), true);
	tr.next();
	tr.next();
	tr.next(); // vuelta completa → ronda 2
	t("rondas sin turno: termina al cambiar de ronda", has(orc, "poisoned"), false);
}

// ---------- Turno anterior y marcar turno a mano no cuentan ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "stunned");
	tr.setEntryDuration(orc.id, "stunned", { kind: "turn-start", of: "target" });
	tr.prev();
	tr.setCurrent(orc.id);
	t("ni «turno anterior» ni marcar el turno terminan duraciones", has(orc, "stunned"), true);
}

// ---------- Concentración del lanzador ----------
{
	const { tr, mage, orc, goblin } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "paralyzed");
	tr.setEntryCaster(orc.id, "paralyzed", { id: mage.id });
	clearNotices();
	tr.setEntryDuration(orc.id, "paralyzed", { kind: "concentration" });
	t("concentración: se aplica al lanzador si no la tenía", has(mage, "concentration"), true);
	t("concentración: con aviso", notices().some((n) => n.includes("Mago no tenía Concentración")), true);
	// Poner el hechizo por primera vez no rompe nada.
	tr.setFocus(mage.id, "concentration", "Inmovilizar persona");
	t("poner el hechizo la primera vez: sigue", has(orc, "paralyzed"), true);
	t("el hechizo queda en la duración", orc.conditions.find((x) => x.id === "paralyzed")?.duration, { kind: "concentration", focus: "Inmovilizar persona" });
	// Cambiar de hechizo termina las ligadas.
	tr.setFocus(mage.id, "concentration", "Bola de fuego");
	t("cambiar de hechizo: termina", has(orc, "paralyzed"), false);
	// Perder la Concentración también.
	tr.addCondition(goblin.id, "frightened");
	tr.setEntryCaster(goblin.id, "frightened", { id: mage.id });
	tr.setEntryDuration(goblin.id, "frightened", { kind: "concentration" });
	tr.removeCondition(mage.id, "concentration");
	t("perder la Concentración: termina", has(goblin, "frightened"), false);
}
// Perderla por daño (llega a 0 PG).
{
	const { tr, mage, orc } = combat();
	tr.addCondition(orc.id, "restrained");
	tr.setEntryCaster(orc.id, "restrained", { id: mage.id });
	tr.setEntryDuration(orc.id, "restrained", { kind: "concentration" });
	tr.damage(mage.id, 25);
	t("el lanzador cae a 0 PG: termina la ligada", has(orc, "restrained"), false);
}

// ---------- Salvación que se repite ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	tr.addCondition(orc.id, "frightened");
	tr.setEntrySave(orc.id, "frightened", { ability: "Sabiduría", dc: 13, when: "end" });
	clearNotices();
	tr.next(); // empieza el turno del Orco: aún no
	t("salvación al final: no avisa al empezar", notices().some((n) => n.includes("repite la salvación")), false);
	tr.next(); // termina el turno del Orco
	t("salvación al final: avisa al acabar su turno", notices().some((n) => n.includes("Orco repite la salvación de Sabiduría CD 13 contra Asustado")), true);
	press("Superada: quitar");
	t("«Superada» quita la condición", has(orc, "frightened"), false);
}

// ---------- Duplicar: solo nombre, PG, CA, iniciativa y marcas ----------
{
	const { tr, orc } = combat();
	tr.damage(orc.id, 5);
	tr.addCondition(orc.id, "poisoned");
	const copy = tr.duplicate(orc.id);
	t("duplicar: PG completos, CA, iniciativa", copy && [copy.name, copy.hp, copy.maxHp, copy.initiative], ["Orco 2", 15, 15, 15]);
	t("duplicar: sin condiciones", copy?.conditions, []);
	t("duplicar: hereda PJ/aliado y oculto", copy && [copy.isPlayer, copy.hidden], [false, false]);
}

// ---------- Acumulables: al terminar baja un nivel, no todos ----------
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	for (let i = 0; i < 3; i++) tr.addCondition(orc.id, "exhaustion", 6);
	tr.setEntryDuration(orc.id, "exhaustion", { kind: "turn-start", of: "target" });
	clearNotices();
	tr.next(); // empieza el turno del Orco
	const ex = orc.conditions.find((x) => x.id === "exhaustion");
	t("acumulable: la duración baja un nivel", ex?.level, 2);
	t("acumulable: la duración cumplida se quita", ex?.duration, undefined);
	t("acumulable: aviso de bajada", notices().some((n) => n.includes("Agotamiento baja a nivel 2")), true);
	// Nivel 1: termina del todo.
	tr.removeCondition(orc.id, "exhaustion", { oneLevel: true });
	tr.setEntryDuration(orc.id, "exhaustion", { kind: "turn-start", of: "target" });
	tr.next();
	tr.next();
	tr.next(); // siguiente inicio del turno del Orco
	t("acumulable en nivel 1: se quita", has(orc, "exhaustion"), false);
}
{
	const { tr, mage, orc } = combat();
	tr.setCurrent(mage.id);
	for (let i = 0; i < 2; i++) tr.addCondition(orc.id, "exhaustion", 6);
	tr.setEntrySave(orc.id, "exhaustion", { ability: "Constitución", when: "start" });
	tr.next(); // empieza el turno del Orco: aviso de salvación
	press("Superada: quitar");
	t("acumulable: «Superada» baja un nivel", orc.conditions.find((x) => x.id === "exhaustion")?.level, 1);
}
