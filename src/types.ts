// Tipos y valores por defecto compartidos por todo el plugin.

export const uid = (): string =>
	Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ---------- Iniciativa ----------

export interface Combatant {
	id: string;
	name: string;
	initiative: number;
	hp: number | null;
	maxHp: number | null;
	/** Puntos de golpe temporales (se gastan antes que los PG; no se acumulan). */
	tempHp: number | null;
	/** Retrato para el modo Tarjetas (imagen de la bóveda + encuadre). */
	portrait?: Portrait | null;
	ac: number | null;
	isPlayer: boolean;
	/** Oculto para los jugadores (no aparece en su pantalla). */
	hidden: boolean;
	/** Condiciones elegidas (las que estas aplican se calculan al mostrarlas). */
	conditions: ConditionEntry[];
}

/**
 * Retrato de un combatiente: imagen de la bóveda y su encuadre dentro del marco cuadrado,
 * en proporción al lado del marco (vale para cualquier tamaño de tarjeta):
 * la imagen se dibuja con ancho `scale`·lado, desplazada `x`·lado y `y`·lado.
 */
export interface Portrait {
	path: string;
	x: number;
	y: number;
	scale: number;
}

/**
 * Condición aplicada a mano a un combatiente. `level` solo para las acumulables
 * (Agotamiento). Las automáticas (por PG o por niveles) no se guardan: se calculan.
 */
export interface ConditionEntry {
	id: string;
	level?: number;
	/**
	 * Lanzador: quién la causó. Un combatiente (`id`) o, para trampas y entornos, un texto
	 * solo informativo (sin turnos ni Concentración, no sirve para duraciones «del lanzador»).
	 */
	caster?: CasterRef;
	/** Duración de esta aplicación concreta (ver `EntryDuration`). */
	duration?: EntryDuration;
	/** Tirada de salvación que se repite en cada turno del objetivo. */
	save?: EntrySave;
	/** Solo en condiciones de concentración (`rules.concentration`): en qué hechizo se concentra. */
	focus?: string;
}

export type CasterRef = { id: string } | { text: string };

/**
 * Duración de una condición aplicada (se asigna desde su ficha; no es de la condición en
 * general). Solo cuenta el botón «Siguiente turno».
 * - `turn-end` / `turn-start`: hasta el final / el inicio del siguiente turno del objetivo
 *   o del lanzador. «Siguiente» = el primero que empieza después de aplicarla; `armed`
 *   indica que ese turno ya empezó (para `turn-end`).
 * - `rounds`: `left` rondas más; se descuenta al empezar el turno de `anchorId` (quien tenía
 *   el turno al aplicarla) o, sin él, al cambiar de ronda.
 * - `concentration`: mientras el lanzador mantenga su concentración en el mismo hechizo
 *   (`focus` = el hechizo al ligarla).
 */
export type EntryDuration =
	| { kind: "turn-end" | "turn-start"; of: "target" | "caster"; armed?: boolean }
	| { kind: "rounds"; rounds: number; left: number; anchorId: string | null }
	| { kind: "concentration"; focus?: string };

/** Salvación que se repite al final o al inicio de cada turno del objetivo. CD opcional. */
export interface EntrySave {
	ability: string;
	dc?: number;
	when: "end" | "start";
}

/** A quién afecta una regla automática: enemigos, PJ y aliados, o todos. */
export type RuleTarget = "enemies" | "allies" | "all";

/**
 * Umbral de PG de una regla automática: un porcentaje del máximo («percent», p. ej. 50 =
 * Ensangrentado), 0 o menos («zero») o el negativo del máximo o menos («negative-max»).
 */
export interface HpTrigger {
	threshold: "percent" | "zero" | "negative-max";
	/** Solo con «percent»: 1–100. */
	percent?: number;
	who: RuleTarget;
}

/** La condición se aplica sola cuando otra condición acumulativa llega a un nivel (Agotamiento 6 → Muerto). */
export interface LevelTrigger {
	conditionId: string;
	minLevel: number;
}


/**
 * Automatismos de una condición. Los tienen igual las de las reglas básicas y las
 * personalizadas; todo es opcional.
 */
export interface ConditionRules {
	/** Se aplica sola según los PG (cualquiera de los umbrales). */
	hpTriggers?: HpTrigger[];
	/** Se aplica sola según el nivel de otra condición acumulativa. */
	levelTriggers?: LevelTrigger[];
	/** Al terminar (sola o quitándola a mano), deja estas condiciones (Inconsciente → Derribado). */
	leaves?: string[];
	/** Termina sola si el combatiente tiene alguna de estas condiciones (Concentración: Incapacitado, Muerto). */
	endsWith?: string[];
	/** Termina sola a 0 PG o menos. */
	endsAtZeroHp?: boolean;
	/** Al recibir daño, avisa de una tirada de salvación de esta característica con la CD de Concentración. */
	damageSave?: { ability: string };
	/** Derrota al enemigo: tachado, sin turno y, para los jugadores, solo se ve esta condición. */
	defeats?: boolean;
	/** Avisa al DM cuando se aplica o termina sola. */
	announce?: boolean;
	/**
	 * Es una concentración: en su ficha se indica el hechizo, y las condiciones con duración
	 * «concentración del lanzador» terminan cuando se pierde o se cambia de hechizo.
	 */
	concentration?: boolean;
}

/** Condición creada por el usuario. */
export interface CustomCondition {
	id: string;
	name: string;
	description: string;
	/** Mismo formato que el icono de los marcadores: emoji, letra, Lucide o «svg:nombre». */
	icon: string;
	/** Color del icono; undefined = color nativo (SVG). Sin fondo. */
	color?: string;
	/** Condiciones que aplica automáticamente (ids). */
	implies?: string[];
	/** Acumulativa: nivel máximo (2 o más). Sin definir = no acumulativa. */
	maxLevel?: number;
	rules?: ConditionRules;
}

/**
 * Cambios del usuario a una condición integrada (por si en su mesa cambian las reglas).
 * Cada campo ausente = el valor original de la condición.
 */
export interface ConditionOverride {
	name?: string;
	/** Descripción en texto libre (sustituye a los apartados originales). */
	description?: string;
	icon?: string;
	/** null = color nativo. */
	color?: string | null;
	implies?: string[];
	/** null = no acumulativa. */
	maxLevel?: number | null;
	/** Sustituye a todos los automatismos originales. */
	rules?: ConditionRules;
	/**
	 * Oculta: no aparece en ningún menú ni editor, no se aplica sola y ninguna otra la
	 * aplica. Solo se ve (atenuada) en los ajustes, para volver a mostrarla.
	 */
	hidden?: boolean;
}

export interface CombatState {
	combatants: Combatant[];
	currentId: string | null;
	round: number;
}

/** "overlay": caja en una esquina; si la pantalla de jugadores está vacía, se amplía para llenarla. */
export type InitiativeDisplay = "off" | "overlay" | "cards";
export type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// ---------- Pantalla de jugadores ----------

/** Rectángulo de un mapa en coordenadas de Leaflet (lat = y, lng = x, en píxeles de la imagen). */
export interface MapRegion {
	south: number;
	west: number;
	north: number;
	east: number;
}

export type PlayerContent =
	| { kind: "note"; path: string; subpath?: string }
	| { kind: "image"; path: string }
	| { kind: "text"; markdown: string; sourcePath: string }
	/** Mapa (.smap): `region` es lo que deben ver los jugadores (null = el mapa entero). */
	| { kind: "map"; path: string; region: MapRegion | null }
	| null;

// ---------- Ajustes ----------

export interface StrakesSettings {
	playerBackground: string;
	playerFontSize: number;
	initiativeDisplay: InitiativeDisplay;
	/** Último modo visible (para el comando mostrar/ocultar). */
	lastInitiativeDisplay: Exclude<InitiativeDisplay, "off">;
	/** Modo Tarjetas: lado del retrato en px y separación entre tarjetas. */
	cardSize: number;
	cardGap: number;
	/** Tamaño (px) del texto de la iniciativa en la pantalla de jugadores (Lista y Tarjetas). */
	initiativeTextSize: number;
	/** Último retrato usado para cada nombre (sin el número: «Goblin 3» → «goblin»). */
	portraitMemory: Record<string, Portrait>;
	overlayPosition: OverlayPosition;
	showPlayerHp: boolean;
	/** Mostrar a los jugadores los PG de los enemigos. */
	showNpcHp: boolean;

	/**
	 * Unidad en la que se muestran distancias y velocidades. «map» = la de cada mapa.
	 * Solo afecta a lo que se muestra: los datos del mapa siguen en su propia unidad.
	 */
	displayUnit: string;
	/** Carpeta donde se crean los mapas nuevos. Vacío = junto a la imagen. */
	mapFolder: string;
	/** Mostrar el título de la nota encima de la vista previa de un pin. */
	pinPreviewTitle: boolean;
	/** Editor de mapas: transparencia (%) de lo que no ven los jugadores, con el mapa en su pantalla. */
	notPlayerTransparency: number;
	/** Mapas: niveles de zoom por paso de la rueda (editor e incrustados). */
	mapZoomStep: number;
	/** Editor de mapas: marco de la vista de jugadores y rectángulo de lo que ven. */
	showPlayerFrame: boolean;
	/** Paso de viaje para calcular tiempos en los mapas. */
	travelPace: "slow" | "normal" | "fast";
	/** Condiciones personalizadas para el tracker de iniciativa. */
	customConditions: CustomCondition[];
	/** Icono/color cambiados por el usuario en las condiciones integradas (por id). */
	conditionOverrides: Record<string, ConditionOverride>;
	/** Secciones plegadas del panel lateral del mapa ("layers", "routes", "pins"). */
	collapsedMapSections: string[];
	combat: CombatState;
}

export const DEFAULT_SETTINGS: StrakesSettings = {
	playerBackground: "#000000",
	playerFontSize: 22,
	initiativeDisplay: "off",
	lastInitiativeDisplay: "overlay",
	cardSize: 200,
	cardGap: 12,
	initiativeTextSize: 20,
	portraitMemory: {},
	overlayPosition: "top-right",
	showPlayerHp: true,
	showNpcHp: false,

	displayUnit: "map",
	mapFolder: "",
	pinPreviewTitle: true,
	notPlayerTransparency: 60,
	mapZoomStep: 0.5,
	showPlayerFrame: true,
	collapsedMapSections: [],
	customConditions: [],
	conditionOverrides: {},
	travelPace: "normal",
	combat: { combatants: [], currentId: null, round: 1 },
};

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

export const MAP_EXTENSION = "smap";

export const VIEW_TYPE_PLAYER = "strakes-player-screen";
export const VIEW_TYPE_INITIATIVE = "strakes-initiative";
export const VIEW_TYPE_MAP = "strakes-map";
