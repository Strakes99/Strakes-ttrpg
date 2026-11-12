import { Component, Editor, Events, MarkdownView, Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { InitiativeTracker } from "./initiative/tracker";
import { InitiativeView } from "./initiative/InitiativeView";
import { IconLibrary, setIconLibrary } from "./map/icons";
import { linkpathMatchesPath, parseWikilink, wikilinkFor } from "./map/links";
import { emptyMap } from "./map/mapData";
import { EmbedContext, MapEmbed } from "./map/MapEmbed";
import { MapView } from "./map/MapView";
import { PlayerScreenView } from "./player/PlayerScreenView";
import { StrakesSettingTab } from "./settings";
import {
	DEFAULT_SETTINGS,
	MAP_EXTENSION,
	PlayerContent,
	StrakesSettings,
	VIEW_TYPE_INITIATIVE,
	VIEW_TYPE_MAP,
	VIEW_TYPE_PLAYER,
} from "./types";
import { ImagePickerModal, isImageFile, loadImageSize } from "./ui/modals";

export default class StrakesTTRPG extends Plugin {
	settings!: StrakesSettings;
	/** Eventos internos: "player-content", "combat", "settings", "icons". */
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
			const n = await this.icons.importFiles(input.files, folder);
			this.events.trigger("icons");
			new Notice(n ? `${n} icono${n > 1 ? "s" : ""} importado${n > 1 ? "s" : ""}.` : "No se importó ningún icono.");
			onDone?.();
		};
		input.click();
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.tracker = new InitiativeTracker(this);

		// Iconos SVG personalizados (carpeta icons/ dentro del plugin). Se cargan antes
		// de registrar las vistas para que los mapas ya los encuentren al abrirse.
		this.icons = new IconLibrary(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		setIconLibrary(this.icons);
		this.register(() => setIconLibrary(null));
		try {
			await this.icons.load();
		} catch (e) {
			console.error("Strakes TTRPG: no se pudieron cargar los iconos", e);
		}

		this.registerView(VIEW_TYPE_PLAYER, (leaf) => new PlayerScreenView(leaf, this));
		this.registerView(VIEW_TYPE_INITIATIVE, (leaf) => new InitiativeView(leaf, this));
		this.registerView(VIEW_TYPE_MAP, (leaf) => new MapView(leaf, this));
		this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
		this.registerMapEmbeds();
		this.registerHoverLinkSource("strakes-ttrpg", { display: "Strakes TTRPG (mapas)", defaultMod: true });

		this.addRibbonIcon("monitor", "Abrir pantalla de jugadores", () => this.openPlayerScreen(true));
		this.addRibbonIcon("swords", "Abrir iniciativa", () => this.openInitiative());
		this.addRibbonIcon("map", "Crear mapa nuevo", () => this.pickImageForMap());

		this.registerCommands();
		this.registerMenus();
		this.registerEvent(this.app.vault.on("rename", (f, old) => void this.onRename(f, old)));
		this.addSettingTab(new StrakesSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian cierra las vistas registradas automáticamente.
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.combat = Object.assign({}, DEFAULT_SETTINGS.combat, loaded.combat);
		// Copia propia: si no, se modificaría el array de DEFAULT_SETTINGS al plegar secciones.
		this.settings.collapsedMapSections = Array.isArray(loaded.collapsedMapSections) ? [...loaded.collapsedMapSections] : [];
		this.settings.customConditions = Array.isArray(loaded.customConditions) ? [...loaded.customConditions] : [];
		this.settings.conditionOverrides = loaded.conditionOverrides && typeof loaded.conditionOverrides === "object" ? { ...loaded.conditionOverrides } : {};
		this.settings.portraitMemory = loaded.portraitMemory && typeof loaded.portraitMemory === "object" ? { ...loaded.portraitMemory } : {};
		// Condiciones de los combatientes: lista de { id, level }. Lo que no lo sea se descarta.
		this.settings.combat.combatants = (this.settings.combat.combatants ?? []).map((c) => ({
			...c,
			conditions: Array.isArray(c.conditions) ? c.conditions.filter((x) => x && typeof x.id === "string") : [],
			tempHp: typeof c.tempHp === "number" && c.tempHp > 0 ? c.tempHp : null,
		}));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---------- Comandos ----------

	private registerCommands(): void {
		this.addCommand({ id: "open-player-screen", name: "Abrir pantalla de jugadores", callback: () => this.openPlayerScreen(true) });
		this.addCommand({
			id: "player-screen-fullscreen",
			name: "Pantalla de jugadores: alternar pantalla completa",
			callback: async () => (await this.openPlayerScreen(false))?.toggleFullscreen(),
		});
		this.addCommand({ id: "clear-player-screen", name: "Limpiar pantalla de jugadores", callback: () => this.sendToPlayers(null) });
		this.addCommand({
			id: "send-active-file",
			name: "Enviar nota/imagen activa a la pantalla de jugadores",
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
			name: "Enviar sección actual (encabezado bajo el cursor) a la pantalla de jugadores",
			editorCallback: (editor: Editor, view) => {
				const file = view.file;
				if (!file) return;
				const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
				const line = editor.getCursor().line;
				const h = [...headings].reverse().find((x) => x.position.start.line <= line);
				if (!h) {
					new Notice("El cursor no está bajo ningún encabezado; se envía la nota completa.");
					void this.sendToPlayers({ kind: "note", path: file.path });
					return;
				}
				void this.sendToPlayers({ kind: "note", path: file.path, subpath: `#${h.heading}` });
			},
		});
		this.addCommand({
			id: "send-selection",
			name: "Enviar texto seleccionado a la pantalla de jugadores",
			editorCheckCallback: (checking, editor, view) => {
				const sel = editor.getSelection();
				if (!sel.trim()) return false;
				if (!checking) void this.sendToPlayers({ kind: "text", markdown: sel, sourcePath: view.file?.path ?? "" });
				return true;
			},
		});
		this.addCommand({
			id: "send-image",
			name: "Elegir imagen y enviarla a la pantalla de jugadores",
			callback: () => new ImagePickerModal(this.app, (f) => void this.sendToPlayers({ kind: "image", path: f.path })).open(),
		});
		this.addCommand({ id: "open-initiative", name: "Abrir iniciativa", callback: () => this.openInitiative() });
		this.addCommand({ id: "initiative-next", name: "Iniciativa: siguiente turno", callback: () => this.tracker.next() });
		this.addCommand({ id: "initiative-prev", name: "Iniciativa: turno anterior", callback: () => this.tracker.prev() });
		this.addCommand({
			id: "initiative-cycle-display",
			name: "Iniciativa: mostrar/ocultar en la pantalla de jugadores",
			callback: async () => {
				const show = this.settings.initiativeDisplay === "off";
				this.settings.initiativeDisplay = show ? this.settings.lastInitiativeDisplay : "off";
				await this.saveSettings();
				this.events.trigger("settings");
				if (show) await this.openPlayerScreen(false);
				new Notice(`Iniciativa en pantalla de jugadores: ${show ? "visible" : "oculta"}`);
			},
		});
		this.addCommand({ id: "create-map", name: "Crear mapa nuevo desde una imagen", callback: () => this.pickImageForMap() });
	}

	private registerMenus(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				const content = this.contentForFile(file);
				if (content)
					menu.addItem((i) =>
						i
							.setTitle("Enviar a la pantalla de jugadores")
							.setIcon("monitor")
							.setSection("action")
							.onClick(() => void this.sendToPlayers(content)),
					);
				if (isImageFile(file))
					menu.addItem((i) =>
						i
							.setTitle("Crear mapa con esta imagen")
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
						.setTitle("Enviar selección a la pantalla de jugadores")
						.setIcon("monitor")
						.onClick(() => void this.sendToPlayers({ kind: "text", markdown: sel, sourcePath: view.file?.path ?? "" })),
				);
			}),
		);
	}

	private contentForFile(file: TFile): PlayerContent {
		if (file.extension === "md") return { kind: "note", path: file.path };
		if (isImageFile(file)) return { kind: "image", path: file.path };
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
		if (focus) this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof PlayerScreenView ? leaf.view : null;
	}

	async sendToPlayers(content: PlayerContent): Promise<void> {
		this.playerContent = content;
		if (content) await this.openPlayerScreen(false);
		this.events.trigger("player-content");
	}

	// ---------- Iniciativa ----------

	async openInitiative(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INITIATIVE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: VIEW_TYPE_INITIATIVE, active: true });
		}
		this.app.workspace.revealLeaf(leaf);
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
			console.warn("Strakes TTRPG: esta versión de Obsidian no permite incrustar mapas.");
			return;
		}
		try {
			if (registry.isExtensionRegistered?.(MAP_EXTENSION)) registry.unregisterExtension(MAP_EXTENSION);
			registry.registerExtension(MAP_EXTENSION, (ctx, file, subpath) => new MapEmbed(this, ctx, file, subpath ?? ""));
			this.register(() => registry.unregisterExtension(MAP_EXTENSION));
		} catch (e) {
			console.error("Strakes TTRPG: no se pudo registrar el embed de mapas", e);
		}
	}

	private pickImageForMap(): void {
		new ImagePickerModal(this.app, (f) => void this.createMap(f), "Elige la imagen del mapa…").open();
	}

	async createMap(image: TFile): Promise<void> {
		let size = { width: 0, height: 0 };
		try {
			size = await loadImageSize(this.app.vault.getResourcePath(image));
		} catch {
			new Notice("No se pudo leer la imagen; se intentará de nuevo al abrir el mapa.");
		}
		const folder = this.settings.mapFolder || image.parent?.path || "";
		if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
		let path = normalizePath(`${folder}/${image.basename}.${MAP_EXTENSION}`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${image.basename} ${n}.${MAP_EXTENSION}`);
		const data = emptyMap(image.path, size.width, size.height, this.settings.defaultUnit);
		const file = await this.app.vault.create(path, JSON.stringify(data, null, "\t"));
		await this.app.workspace.getLeaf(true).openFile(file);
		new Notice(`Mapa creado: ${file.path}`);
	}

	/** Mantiene los mapas al día cuando se renombran/mueven imágenes o notas enlazadas. */
	private async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile)) return;
		const pc = this.playerContent;
		if (pc && pc.kind !== "text" && pc.path === oldPath) pc.path = file.path;

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

		// Búsqueda rápida: ¿el mapa menciona la ruta o el nombre antiguo?
		const oldBase = (oldPath.split("/").pop() ?? oldPath).replace(/\.md$/, "").toLowerCase();
		const pathNeedle = JSON.stringify(oldPath).slice(1, -1);
		for (const f of this.app.vault.getFiles()) {
			if (f.extension !== MAP_EXTENSION || f === file) continue;
			const text = await this.app.vault.cachedRead(f);
			if (!text.includes(pathNeedle) && !text.toLowerCase().includes(oldBase)) continue;
			await this.app.vault.process(f, (current) => {
				try {
					const d = JSON.parse(current);
					let changed = false;
					if (d.image === oldPath) {
						d.image = file.path;
						changed = true;
					}
					for (const p of d.pins ?? []) {
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
					return changed ? JSON.stringify(d, null, "\t") : current;
				} catch {
					return current;
				}
			});
		}
	}
}
