import { parseDxf } from "../core/parser/parseDocument";
import type { ParseResult } from "../core/model/types";
import type { ParseRequest, ParseResponse } from "./protocol";
import { WORKER_SOURCE } from "./inline.generated";

/**
 * Runs DXF parsing on a Web Worker, falling back to the main thread if Workers
 * are unavailable or misbehave (Obsidian mobile WebView — design doc §6, §11.2).
 * The worker is built to a string at bundle time and launched from a Blob URL,
 * since an Obsidian plugin ships only a single main.js.
 */
export class ParseHost {
	private worker: Worker | null = null;
	private url: string | null = null;
	private nextId = 1;
	private pending = new Map<number, { resolve: (r: ParseResult) => void; reject: (e: Error) => void }>();
	private useFallback = false;

	constructor() {
		this.tryStartWorker();
	}

	private tryStartWorker(): void {
		try {
			const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
			this.url = URL.createObjectURL(blob);
			this.worker = new Worker(this.url);
			this.worker.onmessage = (ev: MessageEvent<ParseResponse>) => this.onMessage(ev.data);
			this.worker.onerror = () => this.degrade();
		} catch {
			this.degrade();
		}
	}

	/** Drop to main-thread parsing; reject nothing already resolved. */
	private degrade(): void {
		this.useFallback = true;
		this.dispose();
	}

	private onMessage(res: ParseResponse): void {
		const entry = this.pending.get(res.id);
		if (!entry) return;
		this.pending.delete(res.id);
		if (res.ok) entry.resolve(res.result);
		else entry.reject(new Error(res.error));
	}

	parse(text: string): Promise<ParseResult> {
		if (this.useFallback || !this.worker) {
			try {
				return Promise.resolve(parseDxf(text));
			} catch (err) {
				return Promise.reject(err instanceof Error ? err : new Error(String(err)));
			}
		}
		const id = this.nextId++;
		const req: ParseRequest = { id, text };
		return new Promise<ParseResult>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker!.postMessage(req);
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}
}
