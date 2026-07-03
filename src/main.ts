import { Plugin, TFolder } from "obsidian";
import { VIEW_TYPE_DXF, DXF_EXTENSIONS } from "./constants";
import { DxfFileView } from "./view/DxfFileView";
import { registerDxfEmbed } from "./view/DxfEmbed";
import { DxfSettingsTab } from "./settings/DxfSettingsTab";
import { DEFAULT_SETTINGS, type DxfPluginSettings } from "./settings/settings";
import { ParseHost } from "./worker/host";
import { createNewDxf } from "./view/newFile";

export default class DxfPlugin extends Plugin {
	declare settings: DxfPluginSettings;
	declare parseHost: ParseHost;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.parseHost = new ParseHost();

		this.registerView(VIEW_TYPE_DXF, (leaf) => new DxfFileView(leaf, this));
		this.registerExtensions(DXF_EXTENSIONS, VIEW_TYPE_DXF);

		registerDxfEmbed(this);

		this.addSettingTab(new DxfSettingsTab(this.app, this));

		this.addCommand({
			id: "dxf-save",
			name: "Save current DXF",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(DxfFileView);
				if (!view) return false;
				if (!checking) void view.save();
				return true;
			},
		});

		// Right-click a folder (or any file) in the file explorer → create a new
		// DXF drawing there and open it in the editor.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				const folder = file instanceof TFolder ? file : file.parent;
				menu.addItem((item) =>
					item
						.setTitle("New DXF drawing")
						.setIcon("file-plus")
						.onClick(() => void createNewDxf(this.app, folder))
				);
			})
		);

		// Command-palette / hotkey equivalent: create in the active file's folder.
		this.addCommand({
			id: "dxf-new",
			name: "Create new DXF drawing",
			callback: () => {
				const parent = this.app.workspace.getActiveFile()?.parent ?? null;
				void createNewDxf(this.app, parent);
			},
		});
	}

	onunload(): void {
		this.parseHost?.dispose();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<DxfPluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
