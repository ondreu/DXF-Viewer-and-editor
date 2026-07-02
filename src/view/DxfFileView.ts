import { FileView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { VIEW_TYPE_DXF, DXF_EXTENSIONS } from "../constants";
import { ViewController } from "./ViewController";
import { themeFromObsidian } from "../render/obsidianTheme";
import { isBinaryDxf } from "../core/parser/tokenizer";
import type DxfPlugin from "../main";
import Toolbar from "../ui/Toolbar.svelte";
import Sidebar from "../ui/Sidebar.svelte";

/**
 * File view for `.dxf` files (design doc §5). All I/O goes through the Vault
 * adapter's binary API — never Node `fs` — so the plugin works on mobile.
 * Saving is explicit (no silent autosave) which is deliberate while round-trip
 * fidelity is still being proven (§8.3).
 */
export class DxfFileView extends FileView {
	private controller: ViewController | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private toolbar: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private sidebar: any = null;

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
			this.renderError("Binary DXF files are not supported in v1 (ASCII DXF only).");
			return;
		}
		const text = new TextDecoder("utf-8").decode(bytes);

		// Layout: toolbar on top, then a row of canvas (flex) + sidebar.
		const toolbarEl = host.createDiv({ cls: "dxf-toolbar-slot" });
		const bodyEl = host.createDiv({ cls: "dxf-body" });
		const canvasEl = bodyEl.createDiv({ cls: "dxf-canvas" });
		const sidebarEl = bodyEl.createDiv({ cls: "dxf-sidebar-slot" });

		this.controller = new ViewController(canvasEl, themeFromObsidian(host));

		this.toolbar = new Toolbar({
			target: toolbarEl,
			props: { controller: this.controller, onSave: () => this.save() },
		});
		this.sidebar = new Sidebar({
			target: sidebarEl,
			props: { controller: this.controller, nudgeStep: this.plugin.settings.nudgeStep },
		});

		try {
			const result = await this.plugin.parseHost.parse(text);
			this.controller.load(result);
		} catch (err) {
			this.renderError("Failed to parse DXF: " + (err instanceof Error ? err.message : String(err)));
			return;
		}

		this.registerDomEvent(host, "keydown", (ev) => this.onKeyDown(ev));
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				this.controller?.setTheme(themeFromObsidian(this.contentEl));
			})
		);
	}

	private onKeyDown(ev: KeyboardEvent): void {
		if (!this.controller) return;
		const step = this.plugin.settings.nudgeStep;
		const mod = ev.ctrlKey || ev.metaKey;
		if (mod && ev.key.toLowerCase() === "s") {
			ev.preventDefault();
			this.save();
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
		if (!this.controller.dirty) {
			new Notice("DXF: no changes to save.");
			return;
		}
		const text = this.controller.serialize();
		if (text === null) return;
		const bytes = new TextEncoder().encode(text);
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		await this.app.vault.modifyBinary(this.file, buffer);
		this.controller.markSaved();
		new Notice("DXF saved.");
	}

	private renderError(message: string): void {
		const box = this.contentEl.createDiv({ cls: "dxf-error" });
		box.setText(message);
	}

	async onUnloadFile(): Promise<void> {
		this.toolbar?.$destroy?.();
		this.sidebar?.$destroy?.();
		this.controller?.dispose();
		this.toolbar = null;
		this.sidebar = null;
		this.controller = null;
	}

	async onClose(): Promise<void> {
		await this.onUnloadFile();
	}
}
