import { Plugin } from "obsidian";
import { VIEW_TYPE_DXF, DXF_EXTENSIONS } from "./constants";
import { DxfFileView } from "./view/DxfFileView";
import { registerDxfEmbed } from "./view/DxfEmbed";
import { DxfSettingsTab } from "./settings/DxfSettingsTab";
import { DEFAULT_SETTINGS, type DxfPluginSettings } from "./settings/settings";
import { ParseHost } from "./worker/host";

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
