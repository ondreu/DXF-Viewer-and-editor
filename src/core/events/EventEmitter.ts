/**
 * Minimal typed event emitter.
 *
 * This is the *only* sanctioned communication channel between the
 * framework-agnostic core/renderer and the Svelte UI shell (design doc §3).
 * The renderer must never import Svelte stores; the UI subscribes here instead.
 */
export type Listener<T> = (payload: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
	private listeners: {
		[K in keyof Events]?: Set<Listener<Events[K]>>;
	} = {};

	on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
		let set = this.listeners[event];
		if (!set) {
			set = new Set();
			this.listeners[event] = set;
		}
		set.add(listener);
		return () => this.off(event, listener);
	}

	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
		this.listeners[event]?.delete(listener);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const set = this.listeners[event];
		if (!set) return;
		// Copy to allow listeners to unsubscribe during emit.
		for (const listener of [...set]) listener(payload);
	}

	clear(): void {
		this.listeners = {};
	}
}
