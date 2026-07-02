import type { ParseResult } from "../core/model/types";

export interface ParseRequest {
	id: number;
	text: string;
}

export type ParseResponse =
	| { id: number; ok: true; result: ParseResult }
	| { id: number; ok: false; error: string };
