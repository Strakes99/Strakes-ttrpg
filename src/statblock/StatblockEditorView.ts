import { Component, getFrontMatterInfo, ItemView, Keymap, PaneType, parseYaml, Scope, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { nameFromNote, readStatblock } from "./data";
import { buildForm } from "./form";
import { renderStatblock, statblockColumns } from "./render";
import { statblockLayout } from "./layout";
import { cleanDraft, Draft, draftFromFrontmatter, writeDraft } from "./notes";

export const VIEW_TYPE_STATBLOCK = "strakes-statblock-editor";

/** Espera tras el último cambio antes de guardar en la nota (y de añadir un paso a deshacer). */
const SAVE_DELAY_MS = 600;

/**
 * Pestaña del formulario de un statblock (1.4, §10.2): el formulario a la izquierda y la vista previa
 * a la derecha (una debajo de otra si no caben).
 *  - Edita un borrador con las propiedades de la nota y lo guarda solo, `SAVE_DELAY_MS` después del
 *    último cambio (`writeDraft`). Cada guardado es un paso de deshacer.
 *  - Deshacer y rehacer: botones de la cabecera de la pestaña. Guardan el borrador entero (JSON).
 *  - Si la nota cambia por fuera (panel de propiedades, otro editor) y no hay cambios sin guardar, el
 *    formulario se vuelve a cargar con lo de la nota.
 */
export class StatblockEditorView extends ItemView {
	private file: TFile | null = null;
	private draft: Draft = {};
	private history: string[] = [];
	private historyIndex = -1;
	private saveTimer: number | null = null;
	private previewTimer: number | null = null;
	/** Lo último guardado (o leído) de la nota, limpio: para distinguir los cambios de fuera. */
	private lastSaved = "";
	/** Cuándo se escribió la nota por última vez desde el formulario. */
	private lastWrite = 0;
	private formEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private previewComponent: Component | null = null;
	private undoButton!: HTMLElement;
	private redoButton!: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: StrakesTTRPG,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_STATBLOCK;
	}

	getDisplayText(): string {
		return this.file ? T("sbForm.tabTitle", { name: this.file.basename }) : T("sbForm.tabTitleEmpty");
	}

	getIcon(): string {
		return "scroll-text";
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path ?? null };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = state && typeof state === "object" && typeof (state as { file?: unknown }).file === "string" ? (state as { file: string }).file : null;
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
		await this.flushSave();
		this.file = file instanceof TFile ? file : null;
		const cached = this.noteDraft();
		this.loadFromNote(true, cached.statblock !== undefined ? cached : await this.noteDraftFromDisk());
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("strakes-sb-editor");
		this.formEl = this.contentEl.createDiv("strakes-sb-form");
		const side = this.contentEl.createDiv("strakes-sb-preview");
		this.previewEl = side.createDiv("strakes-sb-preview-inner");
		// Clic en una parte de la vista previa: lleva a su campo del formulario (los enlaces se siguen abriendo).
		this.registerDomEvent(this.previewEl, "click", (evt) => {
			const node = evt.target as Node | null;
			const el = node?.instanceOf(HTMLElement) ? node : null;
			if (!el || el.closest("a")) return;
			const target = el.closest<HTMLElement>("[data-sb-target]")?.getAttr("data-sb-target");
			if (target) this.focusTarget(target);
		});

		this.redoButton = this.addAction("redo-2", T("sbForm.redo"), () => void this.redo());
		this.undoButton = this.addAction("undo-2", T("sbForm.undo"), () => void this.undo());
		// La nota sustituye al formulario en esta misma pestaña (con Ctrl+clic, como en Obsidian, en otra).
		this.addAction("file-text", T("sbForm.openNote"), (evt) => void this.openNote(evt));
		// Escape cierra el formulario y vuelve a la nota en esta pestaña, como «Abrir la nota» (pedido del
		// desarrollador: antes Obsidian pasaba a otra pestaña y dejaba esta abierta). Una lista de sugerencias
		// abierta tiene su propio ámbito y se cierra primero.
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => {
			void this.openNote();
			return false;
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file === this.file) this.onExternalChange();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (file !== this.file) return;
				// El título de la pestaña sale del nombre de la nota; `updateHeader` no es pública (si falta, se
				// actualiza al volver a abrirla). La ruta nueva se guarda en el estado del espacio de trabajo.
				(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
				this.app.workspace.requestSaveLayout();
			}),
		);
		this.registerEvent(this.plugin.events.on("settings", () => this.renderAll()));
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file === this.file) this.leaf.detach();
			}),
		);
		this.renderAll();
	}

	private async openNote(evt?: MouseEvent): Promise<void> {
		if (!this.file) return;
		await this.flushSave();
		const mod = evt ? Keymap.isModEvent(evt) : false;
		await (mod ? this.app.workspace.getLeaf(mod) : this.leaf).openFile(this.file);
	}

	async onClose(): Promise<void> {
		await this.flushSave();
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.previewComponent?.unload();
	}

	// ------------------------------------------------------------ datos

	private fallbackName(): string {
		const s = this.plugin.settings;
		return this.file ? nameFromNote(this.file.basename, s.statblockPrefix, s.statblockSuffix) : "";
	}

	private noteDraft(): Draft {
		const fm = this.file ? this.app.metadataCache.getFileCache(this.file)?.frontmatter : undefined;
		return draftFromFrontmatter(fm);
	}

	/**
	 * Las propiedades de la nota leídas del archivo, para cuando la caché de Obsidian aún no las tiene
	 * (al restaurar las pestañas al arrancar). Sin esto, el formulario empezaría vacío.
	 */
	private async noteDraftFromDisk(): Promise<Draft> {
		if (!this.file) return {};
		const text = await this.app.vault.cachedRead(this.file);
		const info = getFrontMatterInfo(text);
		if (!info.exists) return {};
		try {
			const fm: unknown = parseYaml(info.frontmatter);
			return fm && typeof fm === "object" ? draftFromFrontmatter(fm as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}

	/** Carga el borrador de la nota. `reset`: empieza el historial de deshacer de cero. */
	private loadFromNote(reset: boolean, draft: Draft = this.noteDraft()): void {
		this.draft = draft;
		this.lastSaved = JSON.stringify(cleanDraft(this.draft));
		if (reset) {
			this.history = [JSON.stringify(this.draft)];
			this.historyIndex = 0;
		} else this.pushHistory();
		this.renderAll();
	}

	private onExternalChange(): void {
		if (this.saveTimer !== null) return; // hay cambios propios por guardar: mandan ellos
		if (Date.now() - this.lastWrite < 1500) return; // eco de nuestro propio guardado
		if (this.formEl?.contains(this.formEl.doc.activeElement)) return; // se está escribiendo aquí
		const now = JSON.stringify(cleanDraft(this.noteDraft()));
		if (now === this.lastSaved) return; // es lo que acabamos de guardar
		this.loadFromNote(false);
	}

	private pushHistory(): void {
		const json = JSON.stringify(this.draft);
		if (json === this.history[this.historyIndex]) return;
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(json);
		this.historyIndex = this.history.length - 1;
		this.updateHistoryButtons();
	}

	private updateHistoryButtons(): void {
		this.undoButton?.toggleClass("is-disabled", this.historyIndex <= 0);
		this.redoButton?.toggleClass("is-disabled", this.historyIndex >= this.history.length - 1);
	}

	/** Tras cada cambio del formulario: vista previa enseguida, guardado y paso de deshacer al parar. */
	private onFormChange(): void {
		this.schedulePreview();
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.flushSave(), SAVE_DELAY_MS);
	}

	/** Guarda ya lo pendiente (al cerrar, al cambiar de nota, antes de deshacer). */
	private async flushSave(): Promise<void> {
		if (this.saveTimer === null) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.pushHistory();
		await this.save();
	}

	private async save(): Promise<void> {
		// Sin `statblock` el borrador no salió de la nota (o no se leyó bien): no se escribe nada encima.
		if (!this.file || this.draft.statblock === undefined) return;
		const clean = JSON.stringify(cleanDraft(this.draft));
		if (clean === this.lastSaved) return;
		this.lastSaved = clean;
		this.lastWrite = Date.now();
		await writeDraft(this.plugin, this.file, this.draft);
	}

	private async undo(): Promise<void> {
		await this.flushSave();
		if (this.historyIndex <= 0) return;
		this.historyIndex--;
		await this.restore();
	}

	private async redo(): Promise<void> {
		await this.flushSave();
		if (this.historyIndex >= this.history.length - 1) return;
		this.historyIndex++;
		await this.restore();
	}

	private async restore(): Promise<void> {
		this.draft = JSON.parse(this.history[this.historyIndex]) as Draft;
		this.renderAll();
		await this.save();
	}

	// ------------------------------------------------------------ dibujo

	private renderAll(): void {
		if (!this.formEl) return;
		this.updateHistoryButtons();
		const scroll = this.formEl.scrollTop;
		if (!this.file) {
			this.formEl.empty();
			this.formEl.createDiv({ cls: "strakes-sb-hint", text: T("sbForm.noFile") });
			this.previewEl.empty();
			return;
		}
		buildForm(this.formEl, {
			plugin: this.plugin,
			draft: this.draft,
			fallbackName: this.fallbackName(),
			changed: () => this.onFormChange(),
			rerender: () => this.renderAll(),
		});
		this.formEl.scrollTop = scroll;
		void this.renderPreview();
	}

	/**
	 * Lleva al campo del formulario marcado con `target` (o, si no está, al más cercano: «entry:actions:2»
	 * → la sección de acciones): abre su sección, lo centra, le pone el cursor y lo resalta un momento.
	 */
	private focusTarget(target: string): void {
		const parts = target.split(":");
		const candidates = parts.map((_, i) => parts.slice(0, parts.length - i).join(":"));
		if (parts[0] === "entry") candidates.push(`section:${parts[1]}`);
		if (parts[0] === "spell") candidates.push("section:spellcasting");
		if (parts[0] === "ability") candidates.push("section:abilities");
		const find = (t: string) => Array.from(this.formEl.querySelectorAll<HTMLElement>("[data-sb-target]")).find((x) => x.getAttr("data-sb-target") === t);
		let el: HTMLElement | undefined;
		for (const c of candidates) if ((el = find(c))) break;
		if (!el) return;
		for (let p: HTMLElement | null = el; p && p !== this.formEl; p = p.parentElement) if (p.instanceOf(HTMLDetailsElement)) p.open = true;
		// Una sección o algo más alto que media pantalla, desde su principio; lo demás, centrado.
		const tall = el.matches("details") || el.offsetHeight > this.formEl.clientHeight / 2;
		el.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
		const focusable = el.matches("input, textarea, select") ? el : el.querySelector<HTMLElement>("input:not([type=checkbox]), textarea, select, input");
		// Un grupo de varios campos (la línea de tipo) solo se resalta, sin poner el cursor en ninguno.
		if (!el.hasAttribute("data-sb-nofocus")) focusable?.focus({ preventScroll: true });
		el.addClass("strakes-sb-flash");
		window.setTimeout(() => el?.removeClass("strakes-sb-flash"), 1200);
	}

	private schedulePreview(): void {
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.previewTimer = window.setTimeout(() => {
			this.previewTimer = null;
			void this.renderPreview();
		}, 150);
	}

	private async renderPreview(): Promise<void> {
		if (!this.file) return;
		const s = this.plugin.settings;
		const sb = readStatblock(this.draft, this.fallbackName());
		const layout = statblockLayout(sb, { metric: s.statblockMetric, catalog: s });
		this.previewComponent?.unload();
		this.previewComponent = new Component();
		this.previewComponent.load();
		this.previewEl.empty();
		await renderStatblock(this.app, this.previewEl, layout, this.file.path, this.previewComponent, statblockColumns(sb, s.statblockColumns), undefined, true);
	}
}

/**
 * Abre el formulario de una nota de statblock. `where`: la pestaña donde se abre (la de la nota, que
 * queda sustituida por el formulario, como pidió el desarrollador; se vuelve con «Abrir la nota» o con
 * la flecha atrás) o, como en Obsidian, el valor de `Keymap.isModEvent` (Ctrl+clic: pestaña nueva…).
 * Si el formulario de esa nota ya está abierto en otra pestaña, la trae al frente.
 */
export async function openStatblockEditor(plugin: StrakesTTRPG, file: TFile, where: WorkspaceLeaf | PaneType | boolean = "tab"): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(VIEW_TYPE_STATBLOCK).find((l) => (l.getViewState().state as { file?: unknown } | undefined)?.file === file.path);
	if (existing) {
		await workspace.revealLeaf(existing);
		return;
	}
	const leaf = where instanceof WorkspaceLeaf ? where : workspace.getLeaf(where);
	await leaf.setViewState({ type: VIEW_TYPE_STATBLOCK, state: { file: file.path }, active: true });
	await workspace.revealLeaf(leaf);
}
