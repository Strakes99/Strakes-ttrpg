import { AbstractInputSuggest, App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import { T } from "../i18n";
import { IMAGE_EXTENSIONS } from "../types";
import type { IconConflict, IconConflictChoice } from "../map/icons";

/**
 * Al importar un SVG con el nombre de otro ya existente: reemplazarlo, guardarlo con otro
 * nombre (propone el primero libre) u omitirlo. Cerrar el diálogo equivale a omitir.
 */
export function askIconConflict(app: App, conflict: IconConflict): Promise<IconConflictChoice> {
	return new Promise((resolve) => new IconConflictModal(app, conflict, resolve).open());
}

class IconConflictModal extends Modal {
	private choice: IconConflictChoice = { action: "skip" };

	constructor(
		app: App,
		private conflict: IconConflict,
		private resolve: (c: IconConflictChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const c = this.conflict;
		const el = this.contentEl;
		this.titleEl.setText(T("modals.anIconAlreadyExists", { name: c.name }));
		el.createEl("p", {
			cls: "setting-item-description",
			text: c.folder
				? T("modals.inTheFolderYouCan", { folder: c.folder })
				: T("modals.inTheMainIconsFolder"),
		});
		let newName = c.suggested;
		const error = el.createDiv({ cls: "strakes-warning" });
		error.hide();
		new Setting(el).setName(T("modals.newName")).addText((t) => {
			t.setValue(newName).onChange((v) => {
				newName = v;
				error.hide();
			});
			t.inputEl.addClass("strakes-wide-input");
		});
		let applyToRest = false;
		if (c.remaining > 0)
			new Setting(el)
				.setName(T("modals.doTheSameForThe"))
				.setDesc(T("modals.forTheFollowingIconsWith"))
				.addToggle((t) => t.setValue(false).onChange((v) => (applyToRest = v)));
		new Setting(el)
			.addButton((b) =>
				b
					.setButtonText(T("modals.replace"))
					.setDestructive()
					.onClick(() => this.done({ action: "replace", applyToRest })),
			)
			.addButton((b) => b.setButtonText(T("modals.skip")).onClick(() => this.done({ action: "skip", applyToRest })))
			.addButton((b) =>
				b
					.setButtonText(T("modals.saveWithTheNewName"))
					.setCta()
					.onClick(async () => {
						const name = newName.trim();
						if (!name) {
							error.setText(T("modals.enterAName"));
							error.show();
							return;
						}
						if (await c.exists(name)) {
							error.setText(T("modals.alsoExistsChooseAnotherName", { name }));
							error.show();
							return;
						}
						this.done({ action: "rename", name, applyToRest });
					}),
			);
	}

	private done(choice: IconConflictChoice): void {
		this.choice = choice;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.choice);
	}
}

/** Pide un texto al usuario. Resuelve null si se cancela. */
export function promptText(
	app: App,
	title: string,
	opts: { placeholder?: string; value?: string; description?: string } = {},
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new PromptModal(app, title, opts, resolve);
		modal.open();
	});
}

class PromptModal extends Modal {
	private value: string;
	private done = false;

	constructor(
		app: App,
		private title: string,
		private opts: { placeholder?: string; value?: string; description?: string },
		private resolve: (v: string | null) => void,
	) {
		super(app);
		this.value = opts.value ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		if (this.opts.description) this.contentEl.createEl("p", { text: this.opts.description, cls: "setting-item-description" });
		const input = this.contentEl.createEl("input", {
			type: "text",
			cls: "strakes-prompt-input",
			attr: { placeholder: this.opts.placeholder ?? "" },
		});
		input.value = this.value;
		input.addEventListener("input", () => (this.value = input.value));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(T("modals.ok")).setCta().onClick(() => this.submit()))
			.addButton((b) => b.setButtonText(T("modals.cancel")).onClick(() => this.close()));
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 10);
	}

	private submit(): void {
		this.done = true;
		this.resolve(this.value);
		this.close();
	}

	onClose(): void {
		if (!this.done) this.resolve(null);
		this.contentEl.empty();
	}
}

/** Pide confirmación (sí/no). */
export function confirmDialog(app: App, title: string, message: string, okText = T("modals.delete")): Promise<boolean> {
	return new Promise((resolve) => {
		const m = new Modal(app);
		let ok = false;
		m.titleEl.setText(title);
		m.contentEl.createEl("p", { text: message });
		new Setting(m.contentEl)
			.addButton((b) =>
				b
					.setButtonText(okText)
					// Destructiva (eliminar, vaciar…): en rojo. Con setCta() Obsidian la pinta con el
					// color de acento en lugar de rojo, así que no se combina.
					.setDestructive()
					.onClick(() => {
						ok = true;
						m.close();
					}),
			)
			.addButton((b) => b.setButtonText(T("modals.cancel")).onClick(() => m.close()));
		m.onClose = () => resolve(ok);
		m.open();
	});
}

export function isImageFile(f: TFile): boolean {
	return IMAGE_EXTENSIONS.includes(f.extension.toLowerCase());
}

/** Selector difuso de imágenes de la bóveda. */
export class ImagePickerModal extends FuzzySuggestModal<TFile> {
	/**
	 * @param initialQuery Búsqueda con la que se abre (p. ej. el nombre del personaje en los
	 * retratos). Queda seleccionada: escribir la sustituye.
	 */
	constructor(
		app: App,
		private onPick: (f: TFile) => void,
		placeholder = T("modals.chooseAnImage"),
		private initialQuery = "",
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	onOpen(): void {
		void super.onOpen();
		const q = this.initialQuery.trim();
		if (!q) return;
		this.inputEl.value = q;
		// Las sugerencias se recalculan con el evento «input», como al escribir.
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.select();
	}
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(isImageFile);
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

/** Autocompletado de archivos para un <input>. */
export class FileInputSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private filter: (f: TFile) => boolean,
		private onPick: (f: TFile) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getFiles()
			.filter((f) => this.filter(f) && f.path.toLowerCase().includes(q))
			.slice(0, 60);
	}

	renderSuggestion(f: TFile, el: HTMLElement): void {
		el.createDiv({ text: f.basename });
		el.createDiv({ text: f.path, cls: "strakes-suggest-path" });
	}

	selectSuggestion(f: TFile): void {
		this.input.value = f.path;
		this.input.dispatchEvent(new Event("input"));
		this.onPick(f);
		this.close();
	}
}

/** Carga una imagen para conocer su tamaño natural. */
export function loadImageSize(src: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => reject(new Error("Could not load the image"));
		img.src = src;
	});
}

/**
 * Fila de botones de un diálogo (Eliminar | Cancelar | Guardar) en un pie fuera del contenido:
 * siempre visible aunque el contenido obligue a desplazarse (accesibilidad; pedido del
 * desarrollador). El contenido se desplaza en su propio hueco (ver .strakes-has-footer en
 * styles.css). Se vacía y se reutiliza en cada render() del diálogo. Lo usan los diálogos de
 * los mapas y el de las condiciones.
 */
export function modalFooter(modal: Modal): Setting {
	modal.modalEl.addClass("strakes-has-footer");
	let footer = modal.modalEl.querySelector<HTMLElement>(":scope > .strakes-modal-footer");
	if (footer) footer.empty();
	else footer = modal.modalEl.createDiv("strakes-modal-footer");
	return new Setting(footer);
}
