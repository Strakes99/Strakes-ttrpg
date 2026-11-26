import { Component, MarkdownRenderer, setIcon } from "obsidian";
import { T } from "../i18n";
import { renderConditionIcon } from "../initiative/conditionUi";
import type StrakesTTRPG from "../main";
import { isStatblock, nameFromNote, readStatblock } from "../statblock/data";
import { statblockLayout } from "../statblock/layout";
import { presetFor } from "../statblock/presets";
import { renderStatblock } from "../statblock/render";
import { applyUsed, readUsed, setUsed, UseRef } from "../statblock/uses";
import { linkifyElement } from "./linkify";
import { findCondition } from "./linkResolve";
import { LinkTag } from "./linkTags";

/**
 * Ventanita de un enlace (1.4, paso 6; §12): la ficha de una condición o el statblock de una criatura.
 * Pequeña, como las fichas de condición del tracker, y **se puede fijar**:
 *  - al pasar el ratón con Ctrl/Cmd sobre el enlace se abre una sin fijar, que se cierra al salir del enlace
 *    y de la ventanita (o con Escape); abrir otra la sustituye;
 *  - con la chincheta se fija: se queda hasta cerrarla con su ×, y se pueden tener varias.
 *  - Un clic en un enlace de condición la abre ya fijada.
 */

const HIDE_DELAY_MS = 300;

let hovering: LinkPopover | null = null;

class LinkPopover {
	readonly el: HTMLElement;
	private pinned = false;
	private hideTimer: number | null = null;
	private component = new Component();
	private cleanup: (() => void)[] = [];

	constructor(
		private plugin: StrakesTTRPG,
		private anchor: HTMLElement,
		tag: LinkTag,
		pinned: boolean,
	) {
		const doc = anchor.doc;
		this.component.load();
		this.el = doc.body.createDiv("strakes-link-popover");
		const head = this.el.createDiv("strakes-link-popover-head");
		const title = head.createDiv("strakes-link-popover-title");
		const pin = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": T("links.pin") } });
		setIcon(pin, "pin");
		pin.addEventListener("click", () => this.setPinned(!this.pinned, pin));
		const close = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": T("links.close") } });
		setIcon(close, "x");
		close.addEventListener("click", () => this.close());
		const body = this.el.createDiv("strakes-link-popover-body");

		if (tag.kind === "condition") this.renderCondition(title, body, tag);
		else this.renderCreature(title, body, tag);

		// Sin fijar: se cierra al salir del enlace y de la ventanita.
		const enter = () => this.cancelHide();
		const leave = () => this.scheduleHide();
		for (const el of [this.anchor, this.el]) {
			el.addEventListener("mouseenter", enter);
			el.addEventListener("mouseleave", leave);
			this.cleanup.push(() => {
				el.removeEventListener("mouseenter", enter);
				el.removeEventListener("mouseleave", leave);
			});
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !this.pinned) this.close();
		};
		doc.addEventListener("keydown", onKey, true);
		this.cleanup.push(() => doc.removeEventListener("keydown", onKey, true));
		this.place();
		if (pinned) this.setPinned(true, pin);
	}

	private renderCondition(title: HTMLElement, body: HTMLElement, tag: LinkTag): void {
		const info = findCondition(tag.name, this.plugin.settings);
		if (!info) {
			title.setText(tag.display);
			body.createDiv({ cls: "strakes-link-popover-empty", text: T("links.notFound", { name: tag.name }) });
			return;
		}
		renderConditionIcon(title.createSpan("strakes-link-popover-icon"), info);
		title.createSpan({ text: info.name });
		const text = body.createDiv("strakes-cond-card-text");
		const description = info.description.trim();
		if (description)
			void MarkdownRenderer.render(this.plugin.app, description, text, "", this.component).then(() => {
				linkifyElement(this.plugin, text);
				this.place();
			});
		else text.setText(T("conditionUi.noDescription"));
	}

	private renderCreature(title: HTMLElement, body: HTMLElement, tag: LinkTag): void {
		const { app, settings } = this.plugin;
		const file = this.plugin.creatures.find(tag.name, tag.source);
		const fm: unknown = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		if (!file || !isStatblock(fm)) {
			title.setText(tag.display);
			body.createDiv({ cls: "strakes-link-popover-empty", text: T("links.notFound", { name: tag.name }) });
			return;
		}
		title.setText(file.basename);
		const open = title.parentElement?.createEl("button", { cls: "clickable-icon", attr: { "aria-label": T("links.openNote") } });
		if (open) {
			title.parentElement?.insertBefore(open, title.nextSibling);
			setIcon(open, "file-text");
			open.addEventListener("click", () => void app.workspace.getLeaf("tab").openFile(file));
		}
		const sb = readStatblock(fm as Record<string, unknown>, nameFromNote(file.basename, settings.statblockPrefix, settings.statblockSuffix));
		// Las casillas funcionan como en el statblock de su nota: lo gastado se lee y se guarda en su bloque.
		const onUse = (ref: UseRef, used: number) => void setUsed(app, file, ref, used);
		void readUsed(app, file)
			.then((used) => {
				applyUsed(sb, used);
				const layout = statblockLayout(sb, { preset: presetFor(settings, sb.preset), catalog: settings });
				return renderStatblock(app, body, layout, file.path, this.component, 1, onUse, false, (el) => linkifyElement(this.plugin, el));
			})
			.then(() => this.place());
	}

	/** Debajo del enlace (o encima, si no cabe), sin salirse de la ventana. */
	private place(): void {
		const win = this.anchor.win;
		const r = this.anchor.getBoundingClientRect();
		const width = Math.min(this.el.hasClass("is-wide") ? 420 : 320, win.innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8));
		this.el.setCssStyles({ width: `${width}px`, left: `${left}px`, top: `${r.bottom + 6}px` });
		const h = this.el.offsetHeight;
		if (r.bottom + 6 + h > win.innerHeight - 8 && r.top - 6 - h > 8) this.el.setCssStyles({ top: `${r.top - 6 - h}px` });
	}

	private setPinned(on: boolean, pin: HTMLElement): void {
		this.pinned = on;
		this.el.toggleClass("is-pinned", on);
		pin.toggleClass("is-active", on);
		pin.setAttr("aria-label", on ? T("links.unpin") : T("links.pin"));
		if (on) {
			this.cancelHide();
			if (hovering === this) hovering = null;
		}
	}

	private cancelHide(): void {
		if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
		this.hideTimer = null;
	}

	private scheduleHide(): void {
		if (this.pinned) return;
		this.cancelHide();
		this.hideTimer = window.setTimeout(() => this.close(), HIDE_DELAY_MS);
	}

	close(): void {
		this.cancelHide();
		for (const c of this.cleanup) c();
		this.component.unload();
		this.el.remove();
		if (hovering === this) hovering = null;
	}

	markWide(): void {
		this.el.addClass("is-wide");
		this.place();
	}
}

/** Abre la ventanita de un enlace. Sin fijar, sustituye a la que hubiera sin fijar. */
export function showLinkPopover(plugin: StrakesTTRPG, anchor: HTMLElement, tag: LinkTag, pinned: boolean): void {
	if (!pinned && hovering) hovering.close();
	const p = new LinkPopover(plugin, anchor, tag, pinned);
	if (tag.kind === "creature") p.markWide();
	if (!pinned) hovering = p;
}
