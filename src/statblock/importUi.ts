import { App, Modal, normalizePath, Notice, stringifyYaml, TFile } from "obsidian";
import { T, TC } from "../i18n";
import type StrakesTTRPG from "../main";
import { modalFooter } from "../ui/modals";
import { STATBLOCK_BLOCK } from "./data";
import { bookLabel, convertMonster, crLabel, isMonster, LegendaryGroup, legendaryGroupIndex, missingGroup } from "./import5e";
import { cleanDraft, collapseProperties, ensureFolder, freeNotePath } from "./notes";

/**
 * Comando «Importar statblocks» (1.4, paso 5): elegir archivos JSON (formato 5etools, sin nombrarlo en la
 * interfaz), escoger las criaturas en una lista con buscador y casillas, y crear sus notas en la carpeta de
 * los statblocks. La conversión está en `import5e.ts`.
 */

type Obj = Record<string, unknown>;

interface Candidate {
	monster: Obj;
	name: string;
	source: string;
	cr: string;
	type: string;
}

/** Abre el selector de archivos del sistema (oculto en el documento activo, como «Importar SVG…»). */
function pickJsonFiles(onFiles: (files: File[]) => void): void {
	const input = activeDocument.body.createEl("input", { type: "file", cls: "strakes-file-input", attr: { accept: ".json,application/json", multiple: "" } });
	input.addEventListener("cancel", () => input.remove());
	input.onchange = () => {
		input.remove();
		if (input.files?.length) onFiles(Array.from(input.files));
	};
	input.click();
}

/** Lee los archivos: criaturas (`monster`, o una lista o una criatura sueltas) y grupos legendarios. */
async function readFiles(files: File[]): Promise<{ monsters: Obj[]; groups: unknown[]; failed: string[] }> {
	const monsters: Obj[] = [];
	const groups: unknown[] = [];
	const failed: string[] = [];
	for (const f of files) {
		try {
			const data: unknown = JSON.parse(await f.text());
			if (Array.isArray(data)) monsters.push(...data.filter(isMonster));
			else if (data && typeof data === "object") {
				const o = data as Obj;
				if (Array.isArray(o.monster)) monsters.push(...o.monster.filter(isMonster));
				if (Array.isArray(o.legendaryGroup)) groups.push(...(o.legendaryGroup as unknown[]));
				if (!Array.isArray(o.monster) && !Array.isArray(o.legendaryGroup) && isMonster(o)) monsters.push(o);
			}
		} catch {
			failed.push(f.name);
		}
	}
	return { monsters, groups, failed };
}

/** Comando «Importar statblocks». */
export function importStatblocks(plugin: StrakesTTRPG): void {
	pickJsonFiles((files) => void new ImportModal(plugin.app, plugin).addFiles(files).then((m) => m.open()));
}

class ImportModal extends Modal {
	private candidates: Candidate[] = [];
	private rawGroups: unknown[] = [];
	private groups = new Map<string, LegendaryGroup>();
	private selected = new Set<Candidate>();
	private query = "";
	private listEl!: HTMLElement;
	private countEl!: HTMLElement;
	private warnEl!: HTMLElement;
	private importButton: HTMLButtonElement | null = null;
	private busy = false;

	constructor(
		app: App,
		private plugin: StrakesTTRPG,
	) {
		super(app);
	}

	/** Añade criaturas y grupos de más archivos (sin repetir criaturas: mismo nombre y libro). */
	async addFiles(files: File[]): Promise<this> {
		const { monsters, groups, failed } = await readFiles(files);
		if (failed.length) new Notice(T("sbImport.unreadable", { files: failed.join(", ") }));
		const seen = new Set(this.candidates.map((c) => `${c.name}|${c.source}`));
		for (const m of monsters) {
			const name = String(m.name).trim();
			const source = typeof m.source === "string" ? m.source : "";
			if (seen.has(`${name}|${source}`)) continue;
			seen.add(`${name}|${source}`);
			const t = m.type;
			const type = typeof t === "string" ? t : t && typeof t === "object" && typeof (t as Obj).type === "string" ? String((t as Obj).type) : "";
			this.candidates.push({ monster: m, name, source, cr: crLabel(m), type });
		}
		this.candidates.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
		this.rawGroups.push(...groups);
		this.groups = legendaryGroupIndex(this.rawGroups);
		if (this.listEl) this.renderList();
		return this;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(T("sbImport.title"));
		contentEl.addClass("strakes-import");
		if (!this.candidates.length) {
			contentEl.createEl("p", { text: T("sbImport.noCreatures") });
		}
		const bar = contentEl.createDiv("strakes-import-bar");
		const search = bar.createEl("input", { type: "search", cls: "strakes-import-search", attr: { placeholder: T("sbImport.search") } });
		search.addEventListener("input", () => {
			this.query = search.value.trim().toLowerCase();
			this.renderList();
		});
		const button = (text: string, run: () => void) => {
			const b = bar.createEl("button", { text });
			b.addEventListener("click", run);
		};
		button(T("sbImport.selectVisible"), () => {
			for (const c of this.visible()) this.selected.add(c);
			this.renderList();
		});
		button(T("sbImport.selectNone"), () => {
			this.selected.clear();
			this.renderList();
		});
		button(T("sbImport.addFiles"), () => pickJsonFiles((files) => void this.addFiles(files)));
		this.warnEl = contentEl.createDiv("strakes-import-warning");
		this.countEl = contentEl.createDiv("strakes-import-count");
		this.listEl = contentEl.createDiv("strakes-import-list");
		modalFooter(this)
			.addButton((b) => b.setButtonText(T("sbImport.cancel")).onClick(() => this.close()))
			.addButton((b) => {
				this.importButton = b.buttonEl;
				b.setCta().onClick(() => void this.runImport());
			});
		this.renderList();
		search.focus();
	}

	private visible(): Candidate[] {
		const q = this.query;
		return q ? this.candidates.filter((c) => c.name.toLowerCase().includes(q) || c.source.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)) : this.candidates;
	}

	private renderList(): void {
		this.listEl.empty();
		const visible = this.visible();
		for (const c of visible) {
			const row = this.listEl.createEl("label", { cls: "strakes-import-row" });
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = this.selected.has(c);
			cb.addEventListener("change", () => {
				if (cb.checked) this.selected.add(c);
				else this.selected.delete(c);
				this.updateCount();
			});
			row.createSpan({ cls: "strakes-import-name", text: c.name });
			row.createSpan({ cls: "strakes-import-meta", text: [bookLabel(c.source), c.cr ? `${TC("statblock.cr")} ${c.cr}` : "", c.type].filter(Boolean).join(" · ") });
		}
		if (!visible.length && this.candidates.length) this.listEl.createDiv({ cls: "strakes-import-empty", text: T("sbImport.noMatches") });
		this.updateCount();
	}

	private updateCount(): void {
		this.countEl.setText(T("sbImport.count", { selected: this.selected.size, total: this.candidates.length }));
		if (this.importButton) {
			this.importButton.setText(T("sbImport.import", { count: this.selected.size }));
			this.importButton.disabled = this.busy || this.selected.size === 0;
		}
		// Criaturas con acciones de guarida o efectos regionales en un archivo que no se ha cargado.
		const missing = [...this.selected].filter((c) => missingGroup(c.monster, this.groups)).length;
		this.warnEl.setText(missing ? T("sbImport.missingGroups", { count: missing }) : "");
		this.warnEl.toggleClass("is-hidden", !missing);
	}

	private async runImport(): Promise<void> {
		if (this.busy || !this.selected.size) return;
		let list = this.candidates.filter((c) => this.selected.has(c));
		// Las que ya tienen nota con su nombre: se pregunta cuáles importar igualmente (con el libro en el nombre).
		const duplicates = list.filter((c) => existingNote(this.plugin, c.name));
		if (duplicates.length) {
			const keep = await confirmDuplicates(this.app, this.plugin, duplicates);
			if (!keep) return;
			list = list.filter((c) => !duplicates.includes(c) || keep.has(c));
			if (!list.length) return;
		}
		this.busy = true;
		this.updateCount();
		const progress = new Notice(T("sbImport.progress", { done: 0, total: list.length }), 0);
		const ctx = { groups: this.groups, headings: { regionalEffects: TC("statblock.regionalEffects") } };
		const folder = await ensureFolder(this.plugin, this.plugin.settings.statblockFolder);
		let done = 0;
		const failed: string[] = [];
		for (const c of list) {
			try {
				await createImportedNote(this.plugin, folder, convertMonster(c.monster, ctx));
				done++;
			} catch (e) {
				console.error("Strakes TTRPG: could not import", c.name, e);
				failed.push(c.name);
			}
			if ((done + failed.length) % 10 === 0) progress.setMessage(T("sbImport.progress", { done: done + failed.length, total: list.length }));
		}
		progress.hide();
		new Notice(failed.length ? T("sbImport.doneWithErrors", { count: done, failed: failed.join(", ") }) : T("sbImport.done", { count: done }));
		this.busy = false;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Crea la nota de una criatura importada: propiedades (limpias y en su orden), el bloque que la dibuja y,
 * debajo, lo que va en el cuerpo (variantes, efectos regionales). Si ya hay una nota con su nombre, se le
 * añade el libro («ST-Aboleth (MM'24)»); si también existe, un número. Nunca se sobrescribe nada.
 */
async function createImportedNote(plugin: StrakesTTRPG, folder: string, c: ReturnType<typeof convertMonster>): Promise<TFile> {
	const s = plugin.settings;
	const base = `${s.statblockPrefix}${c.name}${s.statblockSuffix}`;
	const at = (name: string) => normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
	const labelled = `${s.statblockPrefix}${c.name} (${bookLabel(c.source)})${s.statblockSuffix}`;
	const path = !plugin.app.vault.getAbstractFileByPath(at(clean)) || !c.source ? freeNotePath(plugin, folder, base) : freeNotePath(plugin, folder, labelled);
	const yaml = stringifyYaml(cleanDraft(c.data));
	const content = `---\n${yaml}---\n\`\`\`${STATBLOCK_BLOCK}\n\`\`\`\n${c.body ? `\n${c.body}\n` : ""}`;
	const file = await plugin.app.vault.create(path, content);
	collapseProperties(plugin, file, content);
	return file;
}

/** La nota que ya existe con el nombre de esta criatura (prefijo + nombre + sufijo, en la carpeta de statblocks), si la hay. */
function existingNote(plugin: StrakesTTRPG, name: string): TFile | null {
	const s = plugin.settings;
	const folder = normalizePath(s.statblockFolder.trim() || "/");
	const base = `${s.statblockPrefix}${name}${s.statblockSuffix}`.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
	const f = plugin.app.vault.getAbstractFileByPath(normalizePath(folder === "/" ? `${base}.md` : `${folder}/${base}.md`));
	return f instanceof TFile ? f : null;
}

/**
 * Segunda lista: las criaturas que ya tienen nota (pedido del desarrollador). Nada marcado al abrir; las
 * marcadas se importan igualmente, con el libro en el nombre. Devuelve las marcadas, o null si se vuelve
 * atrás. (En el paso 7, también las que el plugin ya incluye.)
 */
function confirmDuplicates(app: App, plugin: StrakesTTRPG, list: Candidate[]): Promise<Set<Candidate> | null> {
	return new Promise((resolve) => {
		const keep = new Set<Candidate>();
		let done = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.titleEl.setText(T("sbImport.duplicatesTitle"));
				this.contentEl.addClass("strakes-import");
				this.contentEl.createEl("p", { text: T("sbImport.duplicatesDesc", { count: list.length }) });
				// «Seleccionar todas» y «Ninguna» (pedido del desarrollador, 2026-11-25: al importar un segundo bestiario son cientos).
				const boxes: HTMLInputElement[] = [];
				const bar = this.contentEl.createDiv("strakes-import-bar");
				const setAll = (on: boolean) => {
					keep.clear();
					if (on) for (const c of list) keep.add(c);
					for (const cb of boxes) cb.checked = on;
				};
				bar.createEl("button", { text: T("sbImport.selectAll") }).addEventListener("click", () => setAll(true));
				bar.createEl("button", { text: T("sbImport.selectNone") }).addEventListener("click", () => setAll(false));
				const listEl = this.contentEl.createDiv("strakes-import-list");
				for (const c of list) {
					const row = listEl.createEl("label", { cls: "strakes-import-row" });
					const cb = row.createEl("input", { type: "checkbox" });
					boxes.push(cb);
					cb.addEventListener("change", () => (cb.checked ? keep.add(c) : keep.delete(c)));
					row.createSpan({ cls: "strakes-import-name", text: c.name });
					const existing = existingNote(plugin, c.name);
					row.createSpan({ cls: "strakes-import-meta", text: [bookLabel(c.source), existing ? T("sbImport.existingNote", { note: existing.basename }) : ""].filter(Boolean).join(" · ") });
				}
				modalFooter(this)
					.addButton((b) => b.setButtonText(T("sbImport.back")).onClick(() => this.close()))
					.addButton((b) =>
						b
							.setButtonText(T("sbImport.continue"))
							.setCta()
							.onClick(() => {
								done = true;
								this.close();
							}),
					);
			}
			onClose(): void {
				this.contentEl.empty();
				resolve(done ? keep : null);
			}
		})(app);
		modal.open();
	});
}
