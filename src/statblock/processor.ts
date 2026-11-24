import { Component, FileView, Keymap, MarkdownPostProcessorContext, MarkdownRenderChild, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { copyStatblock } from "./actions";
import { isStatblock, nameFromNote, readStatblock, STATBLOCK_BLOCK } from "./data";
import { hasBoxes, statblockLayout } from "./layout";
import { resetUses, setUsed, UseRef } from "./uses";
import { renderStatblock, statblockColumns } from "./render";
import { openStatblockEditor } from "./StatblockEditorView";

/**
 * Bloque ` ```strakes-statblock``` `: dibuja el statblock guardado en las propiedades de la nota que lo
 * contiene (maqueta en `layout.ts`, dibujo en `render.ts`). Funciona en modo lectura, en Live Preview,
 * en notas incrustadas y en las vistas previas (en todas ellas `ctx.sourcePath` es la nota del bloque).
 */
export function registerStatblockBlock(plugin: StrakesTTRPG): void {
	plugin.registerMarkdownCodeBlockProcessor(STATBLOCK_BLOCK, (_source, el, ctx) => {
		ctx.addChild(new StatblockRender(plugin, el, ctx));
	});
}

/**
 * Un statblock dibujado. Se vuelve a dibujar cuando cambian las propiedades de su nota (Obsidian no
 * repite el procesador si el bloque no cambia), los ajustes (metros, columnas) o las condiciones
 * (nombres de las inmunidades).
 */
class StatblockRender extends MarkdownRenderChild {
	/** Para no redibujar si lo que sale es igual (el evento de las condiciones salta con cada cambio del combate). */
	private lastKey: string | null = null;
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
		const sb = file instanceof TFile && fm && isStatblock(fm) ? readStatblock(fm as Record<string, unknown>, nameFromNote(file.basename, settings.statblockPrefix, settings.statblockSuffix)) : null;
		const supported = !!sb && /^dnd5e(-|$)/i.test(sb.system);
		const layout = sb && supported ? statblockLayout(sb, { metric: settings.statblockMetric, catalog: settings }) : null;
		const columns = sb ? statblockColumns(sb, settings.statblockColumns) : 1;
		const key = JSON.stringify({ system: sb?.system ?? null, layout, columns });
		if (key === this.lastKey) return;
		this.lastKey = key;
		this.containerEl.empty();
		if (this.content) this.removeChild(this.content);
		this.content = this.addChild(new Component());
		if (!sb) {
			this.containerEl.createDiv({ cls: "strakes-statblock-empty", text: T("statblock.noData") });
			return;
		}
		if (!layout) {
			this.containerEl.createDiv({ cls: "strakes-statblock-empty", text: T("statblock.unsupportedSystem", { system: sb.system }) });
			return;
		}
		const target = file instanceof TFile ? file : null;
		const onUse = target ? (ref: UseRef, used: number) => void setUsed(app, target, ref, used) : undefined;
		const wrap = await renderStatblock(app, this.containerEl, layout, this.ctx.sourcePath, this.content, columns, onUse);
		if (target) this.addActions(wrap, target, hasBoxes(layout));
	}

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

	/**
	 * Botones bajo el statblock: Editar (abre el formulario) y Copiar a nuevo statblock. En Live Preview,
	 * un clic en el bloque entraría a editar su código: se para el evento. En un statblock incrustado en
	 * otra nota ni en la vista previa flotante no se ven (CSS: `.internal-embed` y `.hover-popover`).
	 */
	private addActions(wrap: HTMLElement, file: TFile, withReset: boolean): void {
		const bar = wrap.createDiv("strakes-statblock-actions");
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
		// Vacía todas las casillas (p. ej. tras un descanso largo).
		if (withReset) button("rotate-ccw", T("sbForm.resetUses"), () => void resetUses(this.plugin.app, file));
	}
}
