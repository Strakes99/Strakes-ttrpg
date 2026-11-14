import { AbstractInputSuggest, App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import { T } from "../i18n";
import { IMAGE_EXTENSIONS } from "../types";

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
			.addButton((b) => b.setButtonText(T("Aceptar", "OK")).setCta().onClick(() => this.submit()))
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => this.close()));
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
export function confirmDialog(app: App, title: string, message: string, okText = T("Eliminar", "Delete")): Promise<boolean> {
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
			.addButton((b) => b.setButtonText(T("Cancelar", "Cancel")).onClick(() => m.close()));
		m.onClose = () => resolve(ok);
		m.open();
	});
}

export function isImageFile(f: TFile): boolean {
	return IMAGE_EXTENSIONS.includes(f.extension.toLowerCase());
}

/** Selector difuso de imágenes de la bóveda. */
export class ImagePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (f: TFile) => void, placeholder = T("Elige una imagen…", "Choose an image…")) {
		super(app);
		this.setPlaceholder(placeholder);
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
