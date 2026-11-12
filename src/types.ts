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
	/** Puntos de vida temporales (se gastan antes que los PV; no se acumulan). */
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

/** Condición aplicada a un combatiente. `level` solo para las acumulables (Agotamiento). */
export interface ConditionEntry {
	id: string;
	level?: number;
	/** Puesta automáticamente por el plugin (Inconsciente al llegar un PJ/aliado a 0 PV). */
	auto?: boolean;
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

export type PlayerContent =
	| { kind: "note"; path: string; subpath?: string }
	| { kind: "image"; path: string }
	| { kind: "text"; markdown: string; sourcePath: string }
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
	/** Mostrar a los jugadores los PV de los enemigos. */
	showNpcHp: boolean;
	defaultUnit: string;
	/** Carpeta donde se crean los mapas nuevos. Vacío = junto a la imagen. */
	mapFolder: string;
	/** Mostrar el título de la nota encima de la vista previa de un pin. */
	pinPreviewTitle: boolean;
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
	defaultUnit: "km",
	mapFolder: "",
	pinPreviewTitle: true,
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
