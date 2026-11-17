import { Component, Editor, Events, MarkdownView, Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { T } from "./i18n";
import { InitiativeTracker } from "./initiative/tracker";
import { InitiativeView } from "./initiative/InitiativeView";
import { IconLibrary, setIconLibrary } from "./map/icons";
import { applyAutoNames, AutoNamePin } from "./map/autoName";
import { linkpathMatchesPath, parseWikilink, wikilinkFor } from "./map/links";
import { emptyMap, newMapUnit } from "./map/mapData";
import { LaserState, Stroke } from "./map/drawing";
import { EmbedContext, MapEmbed } from "./map/MapEmbed";
import { MapView } from "./map/MapView";
import { PlayerScreenView } from "./player/PlayerScreenView";
import { StrakesSettingTab } from "./settings";
import {
	DEFAULT_SETTINGS,
	IMAGE_EXTENSIONS,
	LabelState,
	MAP_EXTENSION,
	MapRegion,
	PlayerContent,
	StrakesSettings,
	VIEW_TYPE_INITIATIVE,
	VIEW_TYPE_MAP,
	VIEW_TYPE_PLAYER,
} from "./types";
import { askIconConflict, ImagePickerModal, isImageFile, loadImageSize } from "./ui/modals";

export default class StrakesTTRPG extends Plugin {
	settings!: StrakesSettings;
	/**
	 * Eventos internos:
	 *  - "player-content": cambió lo que muestra la pantalla de jugadores (playerContent).
	 *  - "player-map-view" (animate): cambió la región del mapa que ven los jugadores.
	 *  - "player-resize": cambió el tamaño de la pantalla de jugadores.
	 *  - "player-labels" (path): cambiaron las etiquetas de los jugadores de un mapa.
	 *  - "map-data" (path, data): un mapa cambió en el editor (antes de guardarse).
	 *  - "map-laser" / "map-pen" (path): cambió el láser o el lápiz de un mapa.
	 *  - "combat": cambió el combate o las condiciones.
	 *  - "settings": cambió algún ajuste.
	 *  - "icons": hay que redibujar los iconos SVG.
	 */
	events = new Events();
	playerContent: PlayerContent = null;
	tracker!: InitiativeTracker;
	icons!: IconLibrary;

	/** Vuelve a leer la carpeta de iconos y redibuja los mapas abiertos. */
	async reloadIcons(): Promise<void> {
		await this.icons.load();
		this.events.trigger("icons");
	}

	/** Abre el selector de archivos del sistema para importar SVG a la carpeta de iconos. */
	importIcons(onDone?: () => void, folder = ""): void {
		const input = createEl("input", { type: "file", attr: { accept: ".svg,image/svg+xml", multiple: "" } });
		input.onchange = async () => {
			if (!input.files?.length) return;
			const n = await this.icons.importFiles(input.files, folder, (conflict) => askIconConflict(this.app, conflict));
			this.events.trigger("icons");
			new Notice(
				n
					? T(`${n} icono${n > 1 ? "s" : ""} importado${n > 1 ? "s" : ""}.`, `${n} icon${n > 1 ? "s" : ""} imported.`)
					: T("No se importó ningún icono.", "No icons were imported."),
			);
			onDone?.();
		};
		input.click();
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.tracker = new InitiativeTracker(this);

		// Iconos SVG personalizados (carpeta icons/ dentro del plugin). Se leen cuando
		// Obsidian termina de arrancar, sin retrasar la carga del plugin (con miles de SVG
		// tarda). Al acabar, el evento "icons" redibuja mapas, iniciativa y pantalla de jugadores.
		this.icons = new IconLibrary(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		setIconLibrary(this.icons);
		this.register(() => setIconLibrary(null));
		this.app.workspace.onLayoutReady(() => {
			this.reloadIcons().catch((e) => console.error("Strakes TTRPG: could not load icons", e));
		});

		this.registerView(VIEW_TYPE_PLAYER, (leaf) => new PlayerScreenView(leaf, this));
		this.registerView(VIEW_TYPE_INITIATIVE, (leaf) => new InitiativeView(leaf, this));
		this.registerView(VIEW_TYPE_MAP, (leaf) => new MapView(leaf, this));
		this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
		this.registerMapEmbeds();
		this.registerHoverLinkSource("strakes-ttrpg", { display: T("Strakes TTRPG (mapas)", "Strakes TTRPG (maps)"), defaultMod: true });

		this.addRibbonIcon("monitor", T("Abrir pantalla de jugadores", "Open player screen"), () => this.openPlayerScreen(true));
		this.addRibbonIcon("swords", T("Abrir iniciativa", "Open initiative tracker"), () => this.openInitiative());
		this.addRibbonIcon("map", T("Crear mapa nuevo", "Create new map"), () => this.pickImageForMap());

		this.registerCommands();
		this.registerMenus();
		this.registerEvent(this.app.vault.on("rename", (f, old) => void this.onRename(f, old)));
		this.register(() => {
			if (this.renameTimer !== null) window.clearTimeout(this.renameTimer);
		});
		this.addSettingTab(new StrakesSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian cierra las vistas registradas automáticamente.
	}

	async loadSettings(): Promise<void> {
		const raw: unknown = await this.loadData();
		const loaded: Partial<StrakesSettings> = raw && typeof raw === "object" ? raw : {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.combat = Object.assign({}, DEFAULT_SETTINGS.combat, loaded.combat);
		// Copia propia: si no, se modificaría el array de DEFAULT_SETTINGS al plegar secciones.
		this.settings.collapsedMapSections = Array.isArray(loaded.collapsedMapSections) ? [...loaded.collapsedMapSections] : [];
		this.settings.customConditions = Array.isArray(loaded.customConditions) ? [...loaded.customConditions] : [];
		this.settings.conditionOverrides = loaded.conditionOverrides && typeof loaded.conditionOverrides === "object" ? { ...loaded.conditionOverrides } : {};
		// «Leguas» se guarda en el idioma de la interfaz: si el idioma cambió, se adapta (si no,
		// el desplegable de ajustes no mostraría la opción elegida).
		if (["leguas", "leagues"].includes(this.settings.displayUnit)) this.settings.displayUnit = T("leguas", "leagues");
		this.settings.portraitMemory = loaded.portraitMemory && typeof loaded.portraitMemory === "object" ? { ...loaded.portraitMemory } : {};
		// Condiciones de los combatientes: lista de { id, level }. Lo que no lo sea se descarta.
		this.settings.combat.combatants = (this.settings.combat.combatants ?? []).map((c) => ({
			...c,
			// Las entradas con `auto` eran la Inconsciente que guardaba el plugin hasta la 1.0.x:
			// ahora las automáticas se calculan, así que se descartan.
			conditions: Array.isArray(c.conditions) ? c.conditions.filter((x) => x && typeof x.id === "string" && !(x as { auto?: unknown }).auto) : [],
			tempHp: typeof c.tempHp === "number" && c.tempHp > 0 ? c.tempHp : null,
		}));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---------- Comandos ----------

	private registerCommands(): void {
		this.addCommand({ id: "open-player-screen", name: T("Abrir pantalla de jugadores", "Open player screen"), callback: () => this.openPlayerScreen(true) });
		this.addCommand({
			id: "player-screen-fullscreen",
			name: T("Pantalla de jugadores: alternar pantalla completa", "Player screen: toggle fullscreen"),
			callback: async () => (await this.openPlayerScreen(false))?.toggleFullscreen(),
		});
		this.addCommand({ id: "clear-player-screen", name: T("Limpiar pantalla de jugadores", "Clear player screen"), callback: () => this.sendToPlayers(null) });
		this.addCommand({
			id: "send-active-file",
			name: T("Enviar nota/imagen activa a la pantalla de jugadores", "Send active note/image to the player screen"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const content = file ? this.contentForFile(file) : null;
				if (!content) return false;
				if (!checking) void this.sendToPlayers(content);
				return true;
			},
		});
		this.addCommand({
			id: "send-current-section",
			name: T("Enviar sección actual (encabezado bajo el cursor) a la pantalla de jugadores", "Send current section (heading under the cursor) to the player screen"),
			editorCallback: (editor: Editor, view) => {
				const file = view.file;
				if (!file) return;
				const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
				const line = editor.getCursor().line;
				const h = [...headings].reverse().find((x) => x.position.start.line <= line);
				if (!h) {
					new Notice(T("El cursor no está bajo ningún encabezado; se envía la nota completa.", "The cursor isn't under any heading; sending the whole note."));
					void this.sendToPlayers({ kind: "note", path: file.path });
					return;
				}
				void this.sendToPlayers({ kind: "note", path: file.path, subpath: `#${h.heading}` });
			},
		});
		this.addCommand({
			id: "send-selection",
			name: T("Enviar texto seleccionado a la pantalla de jugadores", "Send selected text to the player screen"),
			editorCheckCallback: (checking, editor, view) => {
				const sel = editor.getSelection();
				if (!sel.trim()) return false;
				if (!checking) void this.sendToPlayers({ kind: "text", markdown: sel, sourcePath: view.file?.path ?? "" });
				return true;
			},
		});
		this.addCommand({
			id: "send-image",
			name: T("Elegir imagen y enviarla a la pantalla de jugadores", "Pick an image and send it to the player screen"),
			callback: () => new ImagePickerModal(this.app, (f) => void this.sendToPlayers({ kind: "image", path: f.path })).open(),
		});
		this.addCommand({ id: "open-initiative", name: T("Abrir iniciativa", "Open initiative tracker"), callback: () => this.openInitiative() });
		this.addCommand({ id: "initiative-next", name: T("Iniciativa: siguiente turno", "Initiative: next turn"), callback: () => this.tracker.next() });
		this.addCommand({ id: "initiative-prev", name: T("Iniciativa: turno anterior", "Initiative: previous turn"), callback: () => this.tracker.prev() });
		this.addCommand({
			id: "initiative-cycle-display",
			name: T("Iniciativa: mostrar/ocultar en la pantalla de jugadores", "Initiative: show/hide on the player screen"),
			callback: async () => {
				const show = this.settings.initiativeDisplay === "off";
				this.settings.initiativeDisplay = show ? this.settings.lastInitiativeDisplay : "off";
				await this.saveSettings();
				this.events.trigger("settings");
				if (show) await this.openPlayerScreen(false);
				new Notice(show ? T("Iniciativa visible en la pantalla de jugadores", "Initiative shown on the player screen") : T("Iniciativa oculta en la pantalla de jugadores", "Initiative hidden on the player screen"));
			},
		});
		this.addCommand({ id: "create-map", name: T("Crear mapa nuevo desde una imagen", "Create new map from an image"), callback: () => this.pickImageForMap() });
	}

	private registerMenus(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				const content = this.contentForFile(file);
				if (content)
					menu.addItem((i) =>
						i
							.setTitle(T("Enviar a la pantalla de jugadores", "Send to player screen"))
							.setIcon("monitor")
							.setSection("action")
							.onClick(() => void this.sendToPlayers(content)),
					);
				if (isImageFile(file))
					menu.addItem((i) =>
						i
							.setTitle(T("Crear mapa con esta imagen", "Create map from this image"))
							.setIcon("map")
							.setSection("action")
							.onClick(() => void this.createMap(file)),
					);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view) => {
				const sel = editor.getSelection();
				if (!sel.trim() || !(view instanceof MarkdownView)) return;
				menu.addItem((i) =>
					i
						.setTitle(T("Enviar selección a la pantalla de jugadores", "Send selection to player screen"))
						.setIcon("monitor")
						.onClick(() => void this.sendToPlayers({ kind: "text", markdown: sel, sourcePath: view.file?.path ?? "" })),
				);
			}),
		);
	}

	private contentForFile(file: TFile): PlayerContent {
		if (file.extension === "md") return { kind: "note", path: file.path };
		if (isImageFile(file)) return { kind: "image", path: file.path };
		if (file.extension === MAP_EXTENSION) return { kind: "map", path: file.path, region: null };
		return null;
	}

	// ---------- Pantalla de jugadores ----------

	/** Abre (o reutiliza) la ventana de la pantalla de jugadores. */
	async openPlayerScreen(focus: boolean): Promise<PlayerScreenView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLAYER)[0];
		let leaf: WorkspaceLeaf;
		if (existing) {
			leaf = existing;
		} else {
			leaf = this.app.workspace.openPopoutLeaf({ size: { width: 1280, height: 720 } });
			await leaf.setViewState({ type: VIEW_TYPE_PLAYER, active: true });
		}
		await leaf.loadIfDeferred();
		if (focus) await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof PlayerScreenView ? leaf.view : null;
	}

	async sendToPlayers(content: PlayerContent): Promise<void> {
		this.playerContent = content;
		if (content) await this.openPlayerScreen(false);
		this.events.trigger("player-content");
	}

	/**
	 * Pone un mapa en la pantalla de jugadores con la región indicada. Si ese mapa ya se está
	 * mostrando, solo cambia la región (sin volver a crear el mapa), con animación si se pide.
	 */
	async sendMapToPlayers(path: string, region: MapRegion | null, animate: boolean): Promise<void> {
		const pc = this.playerContent;
		if (pc && pc.kind === "map" && pc.path === path) {
			pc.region = region;
			this.events.trigger("player-map-view", animate);
			return;
		}
		await this.sendToPlayers({ kind: "map", path, region });
	}

	/**
	 * Etiquetas que ven los jugadores en cada mapa (por ruta del .smap). Solo en memoria: mostrar
	 * etiquetas es circunstancial y no se guarda (decisión del desarrollador). Al empezar, ninguna.
	 */
	private playerLabelState = new Map<string, LabelState>();

	playerLabels(path: string): LabelState {
		return this.playerLabelState.get(path) ?? { pins: false, routes: false };
	}

	setPlayerLabels(path: string, state: LabelState): void {
		this.playerLabelState.set(path, state);
		this.events.trigger("player-labels", path);
	}

	/**
	 * Láser y lápiz de cada mapa (por ruta del .smap). Solo en memoria: los dibujos no se guardan y
	 * se borran al cerrar Obsidian (aunque se cierre y reabra el mapa, siguen ahí).
	 */
	private laserStates = new Map<string, LaserState>();
	private penStates = new Map<string, Stroke[]>();
	/** Color del lápiz elegido en la barra en esta sesión (null = el del láser). */
	penColor: string | null = null;

	laserFor(path: string): LaserState {
		let st = this.laserStates.get(path);
		if (!st) {
			st = { pointer: null, color: this.settings.laserColor, strokes: [] };
			this.laserStates.set(path, st);
		}
		return st;
	}

	penFor(path: string): Stroke[] {
		let st = this.penStates.get(path);
		if (!st) {
			st = [];
			this.penStates.set(path, st);
		}
		return st;
	}

	/** Al renombrar o mover un mapa, su estado en memoria (etiquetas de jugadores, láser, lápiz) pasa a la ruta nueva. */
	private moveMapState(oldPath: string, newPath: string): void {
		const move = <T>(map: Map<string, T>): boolean => {
			const value = map.get(oldPath);
			if (value === undefined) return false;
			map.delete(oldPath);
			map.set(newPath, value);
			return true;
		};
		if (move(this.playerLabelState)) this.events.trigger("player-labels", newPath);
		if (move(this.laserStates)) this.events.trigger("map-laser", newPath);
		if (move(this.penStates)) this.events.trigger("map-pen", newPath);
	}

	/** Proporción (ancho / alto) de la pantalla de jugadores, o null si no está abierta. */
	playerAspect(): number | null {
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLAYER)[0]?.view;
		return view instanceof PlayerScreenView ? view.contentAspect() : null;
	}

	// ---------- Iniciativa ----------

	async openInitiative(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INITIATIVE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: VIEW_TYPE_INITIATIVE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	// ---------- Mapas ----------

	/**
	 * Permite incrustar mapas en notas con ![[mapa.smap]].
	 * Usa `app.embedRegistry`, una API interna de Obsidian (la misma que usan Canvas y Bases);
	 * si algún día cambia, el plugin sigue funcionando y solo se pierde el embed.
	 */
	private registerMapEmbeds(): void {
		type EmbedRegistry = {
			registerExtension(ext: string, creator: (ctx: EmbedContext, file: TFile, subpath: string) => Component): void;
			unregisterExtension(ext: string): void;
			isExtensionRegistered?(ext: string): boolean;
		};
		const registry = (this.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
		if (!registry?.registerExtension) {
			console.warn("Strakes TTRPG: this Obsidian version doesn't support map embeds.");
			return;
		}
		try {
			if (registry.isExtensionRegistered?.(MAP_EXTENSION)) registry.unregisterExtension(MAP_EXTENSION);
			registry.registerExtension(MAP_EXTENSION, (ctx, file, subpath) => new MapEmbed(this, ctx, file, subpath ?? ""));
			this.register(() => registry.unregisterExtension(MAP_EXTENSION));
		} catch (e) {
			console.error("Strakes TTRPG: could not register map embeds", e);
		}
	}

	private pickImageForMap(): void {
		new ImagePickerModal(this.app, (f) => void this.createMap(f), T("Elige la imagen del mapa…", "Choose the map image…")).open();
	}

	async createMap(image: TFile): Promise<void> {
		let size = { width: 0, height: 0 };
		try {
			size = await loadImageSize(this.app.vault.getResourcePath(image));
		} catch {
			new Notice(T("No se pudo leer la imagen; se intentará de nuevo al abrir el mapa.", "Couldn't read the image; it will be retried when the map opens."));
		}
		const folder = this.settings.mapFolder || image.parent?.path || "";
		if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
		let path = normalizePath(`${folder}/${image.basename}.${MAP_EXTENSION}`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${image.basename} ${n}.${MAP_EXTENSION}`);
		const data = emptyMap(image.path, size.width, size.height, newMapUnit(this.settings.displayUnit));
		const file = await this.app.vault.create(path, JSON.stringify(data, null, "\t"));
		await this.app.workspace.getLeaf(true).openFile(file);
		new Notice(T(`Mapa creado: ${file.path}`, `Map created: ${file.path}`));
	}

	/** Mantiene los mapas al día cuando se renombran/mueven imágenes o notas enlazadas. */
	private async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile)) return;
		const pc = this.playerContent;
		if (pc && pc.kind !== "text" && pc.path === oldPath) {
			pc.path = file.path;
			// Se redibuja para que el título de la nota mostrada lleve el nombre nuevo.
			this.events.trigger("player-content");
		}
		// Etiquetas de los jugadores, láser y lápiz de un mapa: van por la ruta del .smap, así que
		// pasan a la nueva (si no, al renombrar o mover un mapa abierto dejarían de verse).
		this.moveMapState(oldPath, file.path);

		// Retratos de los combatientes y retratos recordados por nombre.
		let portraitsChanged = false;
		for (const p of [...this.settings.combat.combatants.map((c) => c.portrait), ...Object.values(this.settings.portraitMemory)]) {
			if (p && p.path === oldPath) {
				p.path = file.path;
				portraitsChanged = true;
			}
		}
		if (portraitsChanged) {
			await this.saveSettings();
			this.events.trigger("combat");
		}

		// Mapas: solo pueden enlazar notas, otros mapas, lienzos e imágenes (la del mapa). Renombrar
		// cualquier otra cosa no los afecta. Los renombrados se agrupan (mover una carpeta genera
		// uno por archivo) y cada mapa se revisa una sola vez por grupo.
		if (!MAP_LINKABLE_EXTENSIONS.has(file.extension.toLowerCase())) return;
		this.pendingRenames.push({ file, oldPath });
		if (this.renameTimer !== null) window.clearTimeout(this.renameTimer);
		this.renameTimer = window.setTimeout(() => {
			this.renameTimer = null;
			void this.updateMapsAfterRenames();
		}, RENAME_BATCH_MS);
	}

	/** Renombrados pendientes de aplicar a los mapas (ver `onRename`). */
	private pendingRenames: { file: TFile; oldPath: string }[] = [];
	private renameTimer: number | null = null;

	/**
	 * Aplica a los mapas un grupo de renombrados: lee cada .smap una vez y solo reescribe los
	 * que mencionan alguna de las rutas o nombres antiguos (imagen del mapa y enlaces de los
	 * marcadores, con los nombres automáticos de los marcadores con AUTO).
	 */
	private async updateMapsAfterRenames(): Promise<void> {
		const batch = this.pendingRenames;
		this.pendingRenames = [];
		if (!batch.length) return;
		// Búsqueda rápida: ¿el mapa menciona la ruta o el nombre antiguo de alguno?
		const needles = batch.map((r) => ({
			path: JSON.stringify(r.oldPath).slice(1, -1),
			base: (r.oldPath.split("/").pop() ?? r.oldPath).replace(/\.md$/, "").toLowerCase(),
		}));
		for (const f of this.app.vault.getFiles()) {
			if (f.extension !== MAP_EXTENSION) continue;
			const text = await this.app.vault.cachedRead(f);
			const lower = text.toLowerCase();
			if (!needles.some((n) => text.includes(n.path) || lower.includes(n.base))) continue;
			await this.app.vault.process(f, (current) => {
				try {
					const d = JSON.parse(current) as { image?: unknown; pins?: unknown };
					const pins = Array.isArray(d.pins) ? (d.pins as { link?: unknown }[]) : [];
					let changed = false;
					// En orden: si un archivo se renombró dos veces seguidas, se aplican las dos.
					for (const { file, oldPath } of batch) {
						if (d.image === oldPath) {
							d.image = file.path;
							changed = true;
						}
						for (const p of pins) {
							if (typeof p.link !== "string") continue;
							const w = parseWikilink(p.link);
							if (!linkpathMatchesPath(w.linkpath, oldPath)) continue;
							// Si el nombre sigue resolviendo a otra nota distinta, ese enlace no era a la renombrada.
							const still = this.app.metadataCache.getFirstLinkpathDest(w.linkpath, f.path);
							if (still && still !== file) continue;
							const updated = wikilinkFor(this.app, file, f.path, w.subpath, w.alias);
							if (updated !== p.link) {
								p.link = updated;
								changed = true;
							}
						}
					}
					// Marcadores con AUTO: el nombre sigue a la nota renombrada (y los portales a ellos).
					if (changed) applyAutoNames(pins.filter((p): p is AutoNamePin => typeof (p as { id?: unknown }).id === "string"));
					return changed ? JSON.stringify(d, null, "\t") : current;
				} catch {
					return current;
				}
			});
		}
	}
}

/** Archivos que un mapa puede enlazar: notas, mapas y lienzos (marcadores) e imágenes (la del mapa). */
const MAP_LINKABLE_EXTENSIONS = new Set(["md", MAP_EXTENSION, "canvas", ...IMAGE_EXTENSIONS]);
/** Espera tras el último renombrado antes de revisar los mapas (agrupa los de una carpeta movida). */
const RENAME_BATCH_MS = 500;
