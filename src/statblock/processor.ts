import { Component, FileView, Keymap, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { isStatblock, nameFromNote, readStatblock, STATBLOCK_BLOCK } from "./data";
import { copyStatblock } from "./actions";
import { statblockMarkdown } from "./markdown";
import { openStatblockEditor } from "./StatblockEditorView";

/**
 * Bloque ` ```strakes-statblock``` `: dibuja el statblock guardado en las propiedades de la nota que lo
 * contiene, como un callout `[!statblocks]` de ITS Theme (ver `markdown.ts`). Funciona en modo lectura,
 * en Live Preview, en notas incrustadas y en las vistas previas (en todas ellas `ctx.sourcePath` es la
 * nota del bloque).
 */
export function registerStatblockBlock(plugin: StrakesTTRPG): void {
	plugin.registerMarkdownCodeBlockProcessor(STATBLOCK_BLOCK, (_source, el, ctx) => {
		ctx.addChild(new StatblockRender(plugin, el, ctx));
	});
}

/**
 * Un statblock dibujado. Se vuelve a dibujar cuando cambian las propiedades de su nota (Obsidian no
 * repite el procesador si el bloque no cambia), los ajustes (metros) o las condiciones (nombres de
 * las inmunidades).
 */
class StatblockRender extends MarkdownRenderChild {
	/** Para no redibujar si lo que sale es igual (el evento de las condiciones salta con cada cambio del combate). */
	private lastMarkdown: string | null = null;
	/** Dueño de lo que crea cada render (enlaces, incrustados): se descarga al redibujar. */
	private content: Component | null = null;

	constructor(
		private plugin: StrakesTTRPG,
		el: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(el);
	}

	onload(): void {
		const { app } = this.plugin;
		this.registerEvent(
			app.metadataCache.on("changed", (file) => {
				if (file.path === this.ctx.sourcePath) void this.render();
			}),
		);
		this.registerEvent(this.plugin.events.on("settings", () => void this.render()));
		this.registerEvent(this.plugin.events.on("combat", () => void this.render()));
		void this.render();
	}

	private async render(): Promise<void> {
		const { app, settings } = this.plugin;
		const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		const fm: unknown = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		let markdown: string | null = null;
		let isStatblockMarkdown = false;
		if (file instanceof TFile && fm && isStatblock(fm)) {
			const sb = readStatblock(fm as Record<string, unknown>, nameFromNote(file.basename, settings.statblockPrefix, settings.statblockSuffix));
			isStatblockMarkdown = /^dnd5e(-|$)/i.test(sb.system);
			if (isStatblockMarkdown) markdown = statblockMarkdown(sb, { metric: settings.statblockMetric, catalog: settings });
			else markdown = `> [!warning]\n> ${T("statblock.unsupportedSystem", { system: sb.system })}`;
		}
		if (markdown !== null && markdown === this.lastMarkdown) return;
		this.lastMarkdown = markdown;
		this.containerEl.empty();
		if (this.content) this.removeChild(this.content);
		this.content = this.addChild(new Component());
		if (markdown === null) {
			this.containerEl.createDiv({ cls: "strakes-statblock-empty", text: T("statblock.noData") });
			return;
		}
		await MarkdownRenderer.render(app, markdown, this.containerEl, this.ctx.sourcePath, this.content);
		if (file instanceof TFile && isStatblockMarkdown) this.addActions(file);
	}

	/**
	 * Botones bajo el statblock: Editar (abre el formulario) y Copiar a nuevo statblock. En Live Preview,
	 * un clic en el bloque entraría a editar su código: se para el evento.
	 */
	/**
	 * La pestaña de la nota de este statblock, si es la que lo muestra. Si está incrustado en otra nota
	 * (la pestaña muestra otro archivo) o en una vista previa flotante, null: el formulario va a una
	 * pestaña nueva y no sustituye a la otra nota (pedido del desarrollador).
	 */
	private leaf(): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (!found && l.view instanceof FileView && l.view.file?.path === this.ctx.sourcePath && l.view.containerEl.contains(this.containerEl)) found = l;
		});
		return found;
	}

	private addActions(file: TFile): void {
		const bar = this.containerEl.createDiv("strakes-statblock-actions");
		const button = (icon: string, label: string, run: (e: MouseEvent) => void) => {
			const b = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("mousedown", (e) => e.stopPropagation());
			b.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				run(e);
			});
		};
		// El formulario sustituye a la nota en su pestaña (con Ctrl+clic, como en Obsidian, va a otra). Si el
		// statblock está incrustado en otra nota o en una vista previa flotante, se abre en una pestaña nueva.
		button("pencil", T("sbForm.edit"), (e) => void openStatblockEditor(this.plugin, file, Keymap.isModEvent(e) || this.leaf() || "tab"));
		button("copy", T("sbForm.copyToNew"), () => void copyStatblock(this.plugin, file));
	}
}
