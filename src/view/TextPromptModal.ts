import { App, Modal, Setting } from "obsidian";

/** Minimal single-field text prompt used by the text & annotate tools. */
export class TextPromptModal extends Modal {
	private value: string;
	private resolved = false;

	constructor(
		app: App,
		initial: string,
		private title: string,
		private onSubmit: (value: string | null) => void
	) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		const setting = new Setting(this.contentEl).addText((t) => {
			t.setValue(this.value).onChange((v) => (this.value = v));
			t.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") {
					ev.preventDefault();
					this.submit(this.value);
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		setting.addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.submit(this.value)));
		setting.addButton((b) => b.setButtonText("Cancel").onClick(() => this.submit(null)));
	}

	private submit(value: string | null): void {
		this.resolved = true;
		this.close();
		this.onSubmit(value && value.length ? value : null);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.onSubmit(null);
	}
}

export function promptForText(app: App, initial: string, title = "Enter text"): Promise<string | null> {
	return new Promise((resolve) => new TextPromptModal(app, initial, title, resolve).open());
}
