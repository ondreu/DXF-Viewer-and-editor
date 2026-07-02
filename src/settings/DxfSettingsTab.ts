import { App, PluginSettingTab, Setting } from "obsidian";
import type DxfPlugin from "../main";

/** Settings tab built with Obsidian's Setting API (design doc §5, §10). */
export class DxfSettingsTab extends PluginSettingTab {
	constructor(app: App, private plugin: DxfPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Nudge step")
			.setDesc("Distance (drawing units) applied by arrow-key or button nudges.")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.nudgeStep))
					.onChange(async (v) => {
						const n = parseFloat(v);
						if (!Number.isNaN(n) && n > 0) {
							this.plugin.settings.nudgeStep = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Confirm before delete")
			.setDesc("Ask for confirmation before deleting an entity.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.confirmDelete).onChange(async (v) => {
					this.plugin.settings.confirmDelete = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Show markers for unsupported entities")
			.setDesc("Draw a placeholder crosshair where an unsupported entity sits. Unsupported entities are always preserved on save regardless of this setting.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showUnsupportedMarkers).onChange(async (v) => {
					this.plugin.settings.showUnsupportedMarkers = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Embed height")
			.setDesc("Height in pixels for DXF drawings embedded in notes.")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.embedHeight)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (!Number.isNaN(n) && n >= 100) {
						this.plugin.settings.embedHeight = n;
						await this.plugin.saveSettings();
					}
				})
			);
	}
}
