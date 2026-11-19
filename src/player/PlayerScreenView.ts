import { Component, ItemView, MarkdownRenderer, Notice, resolveSubpath, setIcon, setTooltip, TFile, WorkspaceLeaf } from "obsidian";
import { T } from "../i18n";
import type StrakesTTRPG from "../main";
import { renderConditionChips } from "../initiative/conditionUi";
import { defeatingIds, isDefeatedEnemy } from "../initiative/conditions";
import { renderPortrait } from "../initiative/portrait";
import { resizeObserverFor } from "../ui/dom";
import { PlayerMap } from "./PlayerMap";
import { Combatant, VIEW_TYPE_PLAYER } from "../types";

/**
 * Vista que se abre en una ventana emergente y que ven los jugadores.
 * Muestra el contenido enviado (nota, sección, texto, imagen o mapa) y,
 * opcionalmente, el orden de iniciativa (Lista o Tarjetas) encima.
 */
export class PlayerScreenView extends ItemView {
	private contentHost!: HTMLElement;
	private initHost!: HTMLElement;
	private initBox: HTMLElement | null = null;
	private renderComp: Component | null = null;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: StrakesTTRPG) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PLAYER;
	}
	getDisplayText(): string {
		return T("Pantalla de jugadores", "Player screen");
	}
	getIcon(): string {
		return "monitor";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("strakes-player");
		this.contentHost = root.createDiv("strakes-player-content");
		this.initHost = root.createDiv("strakes-player-initiative");

		const toolbar = root.createDiv("strakes-player-toolbar");
		const fs = toolbar.createEl("button", { cls: "clickable-icon" });
		setIcon(fs, "maximize");
		setTooltip(fs, T("Pantalla completa (doble clic también)", "Fullscreen (or double-click)"));
		fs.onclick = () => this.toggleFullscreen();
		const clear = toolbar.createEl("button", { cls: "clickable-icon" });
		setIcon(clear, "eraser");
		setTooltip(clear, T("Limpiar pantalla", "Clear screen"));
		clear.onclick = () => this.plugin.sendToPlayers(null);

		root.addEventListener("dblclick", () => this.toggleFullscreen());

		// Si está en su propia ventana, se oculta la cabecera de la vista (las pestañas se conservan para poder arrastrar la ventana).
		if (this.containerEl.win !== window) this.containerEl.doc.body.addClass("strakes-player-window");

		this.registerEvent(this.plugin.events.on("player-content", () => void this.renderContent()));
		this.registerEvent(this.plugin.events.on("combat", () => this.renderInitiative()));
		// Los SVG se cargan tras el arranque: redibujar los iconos de las condiciones.
		this.registerEvent(this.plugin.events.on("icons", () => this.renderInitiative()));
		this.registerEvent(
			this.plugin.events.on("settings", () => {
				this.applySettings();
				this.renderInitiative();
			}),
		);
		// Recarga en vivo si se edita la nota que se está mostrando. Se espera al índice de
		// Obsidian («changed», no «modify»): con el índice antiguo, una sección enviada se
		// cortaba por posiciones que ya no correspondían al texto nuevo.
		this.registerEvent(
			this.app.metadataCache.on("changed", (f) => {
				const c = this.plugin.playerContent;
				if (c && c.kind === "note" && c.path === f.path) void this.renderContent();
			}),
		);

		// Recalcula la escala al redimensionar la ventana o entrar en pantalla completa.
		const ro = resizeObserverFor(root, () => {
			this.layoutInitiative();
			// El editor del mapa ajusta su marco a la proporción de esta ventana.
			this.plugin.events.trigger("player-resize");
		});
		ro.observe(root);
		this.register(() => ro.disconnect());

		this.applySettings();
		await this.renderContent();
		this.renderInitiative();
	}

	async onClose(): Promise<void> {
		if (this.containerEl.win !== window) this.containerEl.doc.body.removeClass("strakes-player-window");
		this.renderComp?.unload();
		this.plugin.playerScreenClosed();
	}

	toggleFullscreen(): void {
		const doc = this.containerEl.doc;
		if (doc.fullscreenElement) {
			void doc.exitFullscreen();
		} else {
			this.contentEl.requestFullscreen().catch(() => {
				new Notice(T("No se pudo activar la pantalla completa. Haz doble clic en la pantalla de jugadores.", "Couldn't enter fullscreen. Double-click the player screen."));
			});
		}
	}

	/** Proporción (ancho / alto) de la zona de contenido, o null si aún no tiene tamaño. */
	contentAspect(): number | null {
		const el = this.contentHost;
		return el?.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : null;
	}

	private applySettings(): void {
		const s = this.plugin.settings;
		this.contentEl.setCssProps({ "--strakes-player-bg": s.playerBackground, "--strakes-player-font": `${s.playerFontSize}px` });
	}

	// ---------- Contenido ----------

	private async renderContent(): Promise<void> {
		const token = ++this.renderToken;
		const host = this.contentHost;
		const content = this.plugin.playerContent;

		const comp = new Component();
		comp.load();
		const target = createDiv();
		/** Mapa a montar cuando `target` ya esté en la ventana (Leaflet necesita su tamaño). */
		let mapFile: TFile | null = null;

		if (!content) {
			target.addClass("strakes-player-empty");
		} else if (content.kind === "image") {
			const file = this.app.vault.getAbstractFileByPath(content.path);
			if (file instanceof TFile) {
				target.addClass("strakes-player-image-wrap");
				target.createEl("img", { cls: "strakes-player-image", attr: { src: this.app.vault.getResourcePath(file) } });
			} else {
				target.setText(T(`Imagen no encontrada: ${content.path}`, `Image not found: ${content.path}`));
			}
		} else if (content.kind === "map") {
			const file = this.app.vault.getAbstractFileByPath(content.path);
			if (file instanceof TFile) {
				target.addClass("strakes-player-map");
				mapFile = file;
			} else {
				target.setText(T(`Mapa no encontrado: ${content.path}`, `Map not found: ${content.path}`));
			}
		} else {
			let markdown = "";
			let sourcePath = "";
			target.addClass("strakes-player-note", "markdown-rendered");
			if (content.kind === "text") {
				markdown = content.markdown;
				sourcePath = content.sourcePath;
			} else {
				const file = this.app.vault.getAbstractFileByPath(content.path);
				if (!(file instanceof TFile)) {
					markdown = T(`*Nota no encontrada: ${content.path}*`, `*Note not found: ${content.path}*`);
				} else {
					sourcePath = file.path;
					const read = await this.readNote(file, content.subpath);
					if (read === null) {
						// La sección enviada ya no existe (encabezado renombrado o borrado): en lugar de
						// enseñar la nota entera a los jugadores, se vacía la pantalla y se avisa al DM.
						// Solo el dibujado más reciente: con varios guardados seguidos, un aviso.
						comp.unload();
						if (token !== this.renderToken) return;
						const section = (content.subpath ?? "").replace(/^#\^?/, "");
						new Notice(
							T(
								`La sección «${section}» ya no existe en «${file.basename}»: se ha vaciado la pantalla de jugadores.`,
								`The section "${section}" no longer exists in "${file.basename}": the player screen has been cleared.`,
							),
							8000,
						);
						void this.plugin.sendToPlayers(null);
						return;
					}
					markdown = read;
					// Nota completa: su título arriba, como al abrirla en Obsidian (título en línea).
					// Una sección ya empieza por su propio encabezado.
					if (!content.subpath) target.createDiv({ cls: "inline-title strakes-player-title", text: file.basename });
				}
			}
			await MarkdownRenderer.render(this.app, markdown, target, sourcePath, comp);
		}

		// Si llegó otro envío mientras renderizábamos, descartamos este.
		if (token !== this.renderToken) {
			comp.unload();
			return;
		}
		this.renderComp?.unload();
		this.renderComp = comp;
		host.empty();
		host.appendChild(target);
		host.scrollTop = 0;
		// Detrás de la iniciativa, que se dibuja encima (Lista o Tarjetas).
		if (mapFile) comp.addChild(new PlayerMap(this.plugin, target, mapFile));
		// Al vaciar/llenar la pantalla, la iniciativa pasa de ampliada a overlay y viceversa.
		this.layoutInitiative();
	}

	/**
	 * Lee la nota sin frontmatter y, si hay subpath (#encabezado o #^bloque), solo esa sección.
	 * null si la sección ya no existe en la nota.
	 */
	private async readNote(file: TFile, subpath?: string): Promise<string | null> {
		const text = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		if (subpath) {
			// Sin índice todavía no se sabe dónde está la sección: nada (nunca la nota entera). Al
			// indexarla, el evento «changed» la vuelve a dibujar.
			if (!cache) return "";
			const res = resolveSubpath(cache, subpath);
			if (!res) return null;
			return text.slice(res.start.offset, res.end ? res.end.offset : undefined);
		}
		const fm = cache?.frontmatterPosition;
		return fm ? text.slice(fm.end.offset).replace(/^\s+/, "") : text;
	}

	// ---------- Iniciativa ----------

	private renderInitiative(): void {
		const s = this.plugin.settings;
		const host = this.initHost;
		host.empty();
		this.initBox = null;
		const tracker = this.plugin.tracker;
		const visible = tracker.combatants.filter((c) => !c.hidden);

		host.className = `strakes-player-initiative pos-${s.overlayPosition}`;
		if (s.initiativeDisplay === "off" || !visible.length) {
			host.hide();
			return;
		}
		host.show();
		if (s.initiativeDisplay === "cards") {
			this.renderCards(host, visible);
			return;
		}

		const box = host.createDiv("strakes-pi-box");
		this.initBox = box;
		box.createDiv({ cls: "strakes-pi-round", text: T(`Ronda ${tracker.state.round}`, `Round ${tracker.state.round}`) });
		const list = box.createDiv("strakes-pi-list");
		for (const c of visible) {
			const row = list.createDiv("strakes-pi-row");
			row.toggleClass("is-current", c.id === tracker.state.currentId);
			row.toggleClass("is-player", c.isPlayer);
			// Tachado solo para enemigos: un PJ/aliado a 0 PG queda Inconsciente, no muerto.
			const down = isDefeatedEnemy(c, this.plugin.settings);
			row.toggleClass("is-down", down);
			row.createSpan({ cls: "strakes-pi-name", text: c.name });
			const extra = this.hpText(c);
			if (extra) row.createSpan({ cls: "strakes-pi-hp", text: extra });
			// Condiciones: solo iconos, sin interacción. Incluye Ensangrentado (automática por PG),
			// que sustituye al antiguo «estado de los enemigos». Un enemigo tachado solo muestra
			// Muerto a los jugadores; las demás condiciones, solo en el panel del DM.
			const conds = row.createSpan("strakes-pi-cond");
			renderConditionChips(conds, c, { interactive: false, plugin: this.plugin, onlyIds: down ? defeatingIds(this.plugin.settings) : undefined });
			if (!conds.childElementCount) conds.remove();
		}
		this.layoutInitiative();
	}

	/** PG como «30(18)/45» (actuales (temporales) / máximos), si se muestran para ese tipo. */
	private hpText(c: Combatant): string {
		const s = this.plugin.settings;
		const showHp = c.isPlayer ? s.showPlayerHp : s.showNpcHp;
		if (!showHp || c.hp === null) return "";
		// Un enemigo derrotado (tachado) deja de mostrar sus PG aunque esté activado.
		if (isDefeatedEnemy(c, this.plugin.settings)) return "";
		return `${c.hp}${c.tempHp ? `(${c.tempHp})` : ""}${c.maxHp !== null ? `/${c.maxHp}` : ""}`;
	}

	/**
	 * Modo Tarjetas: una tarjeta por combatiente, una al lado de otra (con filas extra si
	 * no caben). Cada tarjeta: nombre encima, retrato cuadrado, PG (si se muestran) y
	 * condiciones. El turno actual lleva un recuadro blanco brillante.
	 */
	private renderCards(host: HTMLElement, visible: Combatant[]): void {
		const s = this.plugin.settings;
		const tracker = this.plugin.tracker;
		host.addClass("mode-cards");
		host.setCssProps({ "--card-gap": `${Math.max(0, s.cardGap)}px` });
		const wrap = host.createDiv("strakes-pc-wrap");
		wrap.createDiv({ cls: "strakes-pi-round strakes-pc-round", text: T(`Ronda ${tracker.state.round}`, `Round ${tracker.state.round}`) });
		const grid = wrap.createDiv("strakes-pc-grid");
		for (const c of visible) {
			const down = isDefeatedEnemy(c, this.plugin.settings);
			const card = grid.createDiv("strakes-pc-card");
			card.toggleClass("is-down", down);
			card.toggleClass("is-player", c.isPlayer);
			// Recuadro del turno actual: nombre + retrato + PG.
			const frame = card.createDiv("strakes-pc-frame");
			frame.toggleClass("is-current", c.id === tracker.state.currentId);
			const name = frame.createDiv({ cls: "strakes-pc-name" });
			name.dataset.full = c.name;
			name.setText(c.name);
			renderPortrait(this.app, frame.createDiv("strakes-pc-portrait"), c);
			const hp = this.hpText(c);
			if (hp) frame.createDiv({ cls: "strakes-pc-hp", text: hp });
			// Un enemigo tachado solo muestra Muerto (las demás condiciones, solo en el panel del DM).
			const conds = card.createDiv("strakes-pc-conds");
			renderConditionChips(conds, c, { interactive: false, plugin: this.plugin, onlyIds: down ? defeatingIds(this.plugin.settings) : undefined });
			if (!conds.childElementCount) conds.remove();
		}
		this.layoutInitiative();
	}

	/** Tamaño del texto de la iniciativa (fijo: no se escala nunca). */
	private textSize(): number {
		return Math.max(8, this.plugin.settings.initiativeTextSize);
	}

	/**
	 * Tarjetas: el texto (nombres y PG) tiene siempre el tamaño configurado. Las tarjetas
	 * se reparten en filas según el ancho de la ventana, y el número de filas según su
	 * altura completa (también con contenido en pantalla: nota, imagen, mapa…). Se respeta el tamaño de
	 * retrato configurado; solo si así no caben, se reduce el retrato lo justo (mínimo
	 * 24 px). Si ni así caben, como último recurso se permite desplazar.
	 */
	private autoFitCards(): void {
		const s = this.plugin.settings;
		const host = this.initHost;
		const wrap = host.querySelector<HTMLElement>(".strakes-pc-wrap");
		const availH = this.contentEl.clientHeight;
		const max = Math.max(24, s.cardSize);
		host.setCssProps({ "--card-size": `${max}px`, "--init-text": `${this.textSize()}px` });
		host.removeClass("can-scroll");
		if (!wrap || !availH) return;
		const fits = () => wrap.offsetHeight <= availH;
		if (fits()) return;
		let lo = 24;
		let hi = max;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			host.setCssProps({ "--card-size": `${mid}px` });
			if (fits()) lo = mid;
			else hi = mid - 1;
		}
		host.setCssProps({ "--card-size": `${lo}px` });
		host.toggleClass("can-scroll", !fits());
	}

	/**
	 * Lista: el texto tiene siempre el tamaño configurado. Los combatientes se reparten en
	 * columnas (en orden de iniciativa: de arriba abajo y luego a la siguiente columna),
	 * con tantas filas por columna como quepan en la altura disponible.
	 *  - Pantalla vacía: casi toda la pantalla.
	 *  - Con contenido en pantalla (nota, imagen, mapa…): caja en la esquina elegida (hasta 45 % × 80 % de la pantalla).
	 * Si las columnas no caben a lo ancho, como último recurso se permite desplazar.
	 */
	private fitList(box: HTMLElement, expanded: boolean): void {
		const list = box.querySelector<HTMLElement>(".strakes-pi-list");
		const area = this.contentEl;
		if (!list || !area.clientWidth || !area.clientHeight) return;
		const availW = area.clientWidth * (expanded ? 0.92 : 0.45);
		const availH = area.clientHeight * (expanded ? 0.92 : 0.8);
		box.setCssStyles({ fontSize: `${this.textSize()}px` });
		box.removeClass("can-scroll");
		list.setCssStyles({ gridTemplateRows: "" });
		const first = list.firstElementChild as HTMLElement | null;
		if (!first) return;
		// Filas por columna según la altura disponible (descontando la cabecera).
		const rowH = first.offsetHeight || 1;
		const chrome = box.offsetHeight - list.offsetHeight;
		const rows = Math.max(1, Math.floor((availH - chrome) / rowH));
		list.setCssStyles({ gridTemplateRows: `repeat(${rows}, auto)` });
		box.toggleClass("can-scroll", box.offsetWidth > availW + 1 || box.offsetHeight > availH + 1);
		if (box.hasClass("can-scroll")) box.setCssStyles({ maxWidth: `${availW}px`, maxHeight: `${availH}px` });
		else box.setCssStyles({ maxWidth: "", maxHeight: "" });
	}

	/**
	 * Recorta los nombres que no caben y los termina en un solo punto («Strahd von Zarov.»).
	 * Se mide con el elemento real, así que respeta la fuente y el tamaño de la tarjeta.
	 */
	private fitCardNames(): void {
		for (const el of Array.from(this.initHost.querySelectorAll<HTMLElement>(".strakes-pc-name"))) {
			const full = el.dataset.full ?? "";
			el.setText(full);
			if (!el.clientWidth || el.scrollWidth <= el.clientWidth) continue;
			let lo = 0;
			let hi = full.length;
			while (lo < hi) {
				const mid = Math.ceil((lo + hi) / 2);
				el.setText(`${full.slice(0, mid).trimEnd()}.`);
				if (el.scrollWidth <= el.clientWidth) lo = mid;
				else hi = mid - 1;
			}
			el.setText(`${full.slice(0, lo).trimEnd()}.`);
		}
	}

	/**
	 * Lista: en columnas, con el tamaño de texto configurado (ver fitList); sin contenido
	 * ocupa casi toda la pantalla, con contenido una caja en la esquina elegida.
	 * Tarjetas: sin contenido ocupan toda la pantalla; con contenido, la parte superior.
	 * El desplazamiento solo aparece como último recurso, si no cabe todo (clase can-scroll).
	 */
	private layoutInitiative(): void {
		const host = this.initHost;
		if (host.hasClass("mode-cards")) {
			host.toggleClass("has-content", this.plugin.playerContent !== null);
			this.autoFitCards();
			this.fitCardNames();
			return;
		}
		const box = this.initBox;
		if (!box) return;
		const expanded = this.plugin.playerContent === null;
		host.toggleClass("is-expanded", expanded);
		this.fitList(box, expanded);
	}
}
