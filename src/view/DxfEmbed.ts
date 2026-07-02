import { MarkdownRenderChild, TFile } from "obsidian";
import { DxfRenderer } from "../render/DxfRenderer";
import { DxfDocument } from "../core/model/DxfDocument";
import { themeFromObsidian } from "../render/obsidianTheme";
import { isBinaryDxf } from "../core/parser/tokenizer";
import type DxfPlugin from "../main";

/**
 * Note embed support for `![[drawing.dxf]]` (design doc §5, §11.1).
 *
 * SPIKE STATUS: Obsidian renders internal embeds of unknown extensions as
 * `.internal-embed` spans; this post-processor detects `.dxf` targets and
 * mounts a read-only viewer into them. Embed semantics for custom extensions
 * shift between Obsidian versions, so this must be re-verified on a real device
 * and across the desktop/mobile split — the doc explicitly flags it as
 * verify-don't-assume. It is intentionally read-only: editing happens in the
 * file view, where the command stack is isolated from Obsidian's editor undo.
 */
export function registerDxfEmbed(plugin: DxfPlugin): void {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
		embeds.forEach((span) => {
			const src = span.getAttribute("src");
			if (!src || !src.toLowerCase().split("#")[0].endsWith(".dxf")) return;
			if (span.hasClass("dxf-embed-mounted")) return;

			const dest = plugin.app.metadataCache.getFirstLinkpathDest(
				src.split("#")[0],
				ctx.sourcePath
			);
			if (!(dest instanceof TFile)) return;

			span.addClass("dxf-embed-mounted");
			span.empty();
			const child = new DxfEmbedChild(plugin, span, dest);
			ctx.addChild(child);
		});
	});
}

class DxfEmbedChild extends MarkdownRenderChild {
	private renderer: DxfRenderer | null = null;

	constructor(private plugin: DxfPlugin, container: HTMLElement, private file: TFile) {
		super(container);
	}

	async onload(): Promise<void> {
		const host = this.containerEl;
		host.addClass("dxf-embed");
		host.style.height = this.plugin.settings.embedHeight + "px";
		const canvas = host.createDiv({ cls: "dxf-canvas" });

		try {
			const buffer = await this.plugin.app.vault.readBinary(this.file);
			const bytes = new Uint8Array(buffer);
			if (isBinaryDxf(bytes)) {
				host.setText("Binary DXF is not supported.");
				return;
			}
			const text = new TextDecoder("utf-8").decode(bytes);
			const result = await this.plugin.parseHost.parse(text);
			const doc = new DxfDocument(
				result.tags,
				result.newline,
				result.ranges,
				result.entities,
				result.layers,
				result.fullyAddressable
			);
			this.renderer = new DxfRenderer(canvas, themeFromObsidian(host));
			this.renderer.loadDocument(doc);
		} catch (err) {
			host.setText("Failed to render DXF: " + (err instanceof Error ? err.message : String(err)));
		}
	}

	onunload(): void {
		this.renderer?.dispose();
		this.renderer = null;
	}
}
