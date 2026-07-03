import { FileView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { VIEW_TYPE_DXF, DXF_EXTENSIONS } from "../constants";
import { ViewController } from "./ViewController";
import { themeFromObsidian } from "../render/obsidianTheme";
import { isBinaryDxf } from "../core/parser/tokenizer";
import { promptForText } from "./TextPromptModal";
import type DxfPlugin from "../main";
import App from "../ui/App.svelte";

/**
 * File view for `.dxf` files (design doc §5). Binary Vault I/O only (mobile
 * safe). The drawing renders full-bleed; the Svelte UI (icon tool palette +
 * floating cards) sits on top. Saving is explicit and writes the DXF back out.
 */
export class DxfFileView extends FileView {
	private controller: ViewController | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private ui: any = null;

	constructor(leaf: WorkspaceLeaf, private plugin: DxfPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DXF;
	}
	getIcon(): string {
		return "shapes";
	}
	getDisplayText(): string {
		return this.file?.basename ?? "DXF";
	}
	canAcceptExtension(extension: string): boolean {
		return DXF_EXTENSIONS.includes(extension.toLowerCase());
	}

	async onLoadFile(file: TFile): Promise<void> {
		const host = this.contentEl;
		host.empty();
		host.addClass("dxf-view-root");

		const buffer = await this.app.vault.readBinary(file);
		const bytes = new Uint8Array(buffer);
		if (isBinaryDxf(bytes)) {
			host.createDiv({ cls: "dxf-error", text: "Binary DXF files are not supported in v1 (ASCII DXF only)." });
			return;
		}
		const text = new TextDecoder("utf-8").decode(bytes);

		const canvasEl = host.createDiv({ cls: "dxf-canvas" });
		const uiEl = host.createDiv({ cls: "dxf-ui-root" });

		// Make the view focusable so tool keyboard shortcuts (Enter/Esc/C, arrows)
		// reach it; refocus whenever the drawing is clicked.
		host.tabIndex = -1;
		this.registerDomEvent(canvasEl, "pointerdown", () => host.focus());

		this.controller = new ViewController(canvasEl, {
			theme: themeFromObsidian(host),
			promptText: (initial, title) => promptForText(this.app, initial, title ?? "Text"),
			toolStickiness: () => this.plugin.settings.toolStickiness,
		});

		this.ui = new App({
			target: uiEl,
			props: {
				controller: this.controller,
				onSave: () => this.save(),
				onScreenshot: () => this.screenshot(),
			},
		});

		try {
			const result = await this.plugin.parseHost.parse(text);
			this.controller.load(result);
		} catch (err) {
			host.createDiv({ cls: "dxf-error", text: "Failed to parse DXF: " + (err instanceof Error ? err.message : String(err)) });
			return;
		}

		this.registerDomEvent(host, "keydown", (ev) => this.onKeyDown(ev));
		this.registerEvent(
			this.app.workspace.on("css-change", () => this.controller?.setTheme(themeFromObsidian(this.contentEl)))
		);
		window.setTimeout(() => host.focus(), 0);
	}

	private async screenshot(): Promise<void> {
		if (!this.controller || !this.file) return;
		const dataUrl = this.controller.screenshotPNG();
		const base64 = dataUrl.split(",")[1] ?? "";
		const bin = atob(base64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const folder = this.file.parent && this.file.parent.path ? this.file.parent.path + "/" : "";
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const path = `${folder}${this.file.basename}-${stamp}.png`;
		await this.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
		new Notice("Screenshot saved: " + path);
	}

	private onKeyDown(ev: KeyboardEvent): void {
		if (!this.controller) return;
		if (this.controller.handleKey(ev)) {
			ev.preventDefault();
			return;
		}
		const mod = ev.ctrlKey || ev.metaKey;
		const step = this.plugin.settings.nudgeStep;
		if (mod && ev.key.toLowerCase() === "s") {
			ev.preventDefault();
			void this.save();
		} else if (mod && ev.key.toLowerCase() === "z") {
			ev.preventDefault();
			ev.shiftKey ? this.controller.redo() : this.controller.undo();
		} else if (mod && ev.key.toLowerCase() === "y") {
			ev.preventDefault();
			this.controller.redo();
		} else if (ev.key === "Delete" || ev.key === "Backspace") {
			this.controller.deleteSelected();
		} else if (ev.key === "ArrowUp") {
			this.controller.moveSelected(0, step);
		} else if (ev.key === "ArrowDown") {
			this.controller.moveSelected(0, -step);
		} else if (ev.key === "ArrowLeft") {
			this.controller.moveSelected(-step, 0);
		} else if (ev.key === "ArrowRight") {
			this.controller.moveSelected(step, 0);
		}
	}

	async save(): Promise<void> {
		if (!this.controller || !this.file) return;
		let saved = false;

		if (this.controller.dxfDirty) {
			const dxf = this.controller.serializeDxf();
			if (dxf !== null) {
				const bytes = new TextEncoder().encode(dxf);
				const out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
				await this.app.vault.modifyBinary(this.file, out);
				this.controller.markDxfSaved();
				saved = true;
			}
		}


		new Notice(saved ? "DXF saved." : "DXF: nothing to save.");
	}

	async onUnloadFile(): Promise<void> {
		this.ui?.$destroy?.();
		this.controller?.dispose();
		this.ui = null;
		this.controller = null;
	}

	async onClose(): Promise<void> {
		await this.onUnloadFile();
	}
}
