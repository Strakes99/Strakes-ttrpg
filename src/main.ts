import { Component, Editor, Events, MarkdownView, Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { T } from "./i18n";
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

		// Iconos SVG personalizados (carpeta icons/ dentro del plugin). Se cargan antes
		// de registrar las vistas para que los mapas ya los encuentren al abrirse.
		this.icons = new IconLibrary(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		setIconLibrary(this.icons);
		this.register(() => setIconLibrary(null));
		try {
			await this.icons.load();
		} catch (e) {
			console.error("Strakes TTRPG: could not load icons", e);
		}

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
		const data = emptyMap(image.path, size.width, size.height, this.settings.defaultUnit);
		const file = await this.app.vault.create(path, JSON.stringify(data, null, "\t"));
		await this.app.workspace.getLeaf(true).openFile(file);
		new Notice(T(`Mapa creado: ${file.path}`, `Map created: ${file.path}`));
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
					const d = JSON.parse(current) as { image?: unknown; pins?: unknown };
					let changed = false;
					if (d.image === oldPath) {
						d.image = file.path;
						changed = true;
					}
					const pins = Array.isArray(d.pins) ? (d.pins as { link?: unknown }[]) : [];
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
					return changed ? JSON.stringify(d, null, "\t") : current;
				} catch {
					return current;
				}
			});
		}
	}
}
