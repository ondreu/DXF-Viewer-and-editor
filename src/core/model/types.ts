/** A single DXF group-code / value pair — the atom of the raw passthrough store. */
export interface DxfTag {
	code: number;
	value: string;
}

/** A 2D point. DXF is 3D but the v1 renderer/editor is planar (design doc §8). */
export interface Point2 {
	x: number;
	y: number;
}

/**
 * Byte range (into the raw tag array) occupied by one entity. Used to patch
 * only the tags a user actually edited, leaving everything else verbatim.
 */
export interface TagRange {
	/** index of the entity's leading `0` tag */
	start: number;
	/** index one past the entity's last tag */
	end: number;
}

export type EntityType =
	| "LINE"
	| "CIRCLE"
	| "ARC"
	| "LWPOLYLINE"
	| "POLYLINE"
	| "TEXT"
	| "MTEXT"
	| "INSERT"
	| "UNSUPPORTED";

/** Entity types the v1 editor may mutate (design doc §8.2). */
export const EDITABLE_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
	"LINE",
	"CIRCLE",
	"ARC",
	"LWPOLYLINE",
	"TEXT",
]);

export interface BaseEntity {
	/** DXF handle (group code 5). Required for editing; may be "" on ancient files. */
	id: string;
	type: EntityType;
	layer: string;
	/** Resolved RGB (0xRRGGBB) used for rendering. */
	color: number;
	/** Raw ACI color number if present (group 62); undefined = BYLAYER. */
	colorNumber?: number;
}

export interface LineEntity extends BaseEntity {
	type: "LINE";
	start: Point2;
	end: Point2;
}

export interface CircleEntity extends BaseEntity {
	type: "CIRCLE";
	center: Point2;
	radius: number;
}

export interface ArcEntity extends BaseEntity {
	type: "ARC";
	center: Point2;
	radius: number;
	/** degrees, CCW from +X */
	startAngle: number;
	endAngle: number;
}

export interface PolylineEntity extends BaseEntity {
	type: "LWPOLYLINE" | "POLYLINE";
	vertices: Point2[];
	closed: boolean;
}

export interface TextEntity extends BaseEntity {
	type: "TEXT" | "MTEXT";
	position: Point2;
	height: number;
	rotation: number;
	/** UNTRUSTED string from the file — never inject as HTML (design doc §5). */
	text: string;
}

export interface InsertEntity extends BaseEntity {
	type: "INSERT";
	position: Point2;
	/** flattened line segments from the referenced block */
	segments: Array<[Point2, Point2]>;
}

export interface UnsupportedEntity extends BaseEntity {
	type: "UNSUPPORTED";
	/** the original DXF type string, e.g. "SPLINE", "HATCH" */
	dxfType: string;
	/** best-effort anchor (first 10/20 tag) so it can be shown as a placeholder */
	position?: Point2;
}

export type RenderEntity =
	| LineEntity
	| CircleEntity
	| ArcEntity
	| PolylineEntity
	| TextEntity
	| InsertEntity
	| UnsupportedEntity;

export interface LayerInfo {
	name: string;
	color: number;
	visible: boolean;
}

/** Result shipped from the parse worker back to the main thread. */
export interface ParseResult {
	tags: DxfTag[];
	newline: string;
	entities: RenderEntity[];
	/** handle -> raw tag range within `tags` */
	ranges: Record<string, TagRange>;
	layers: LayerInfo[];
	/** true when every entity carried a handle (i.e. editing is safe) */
	fullyAddressable: boolean;
}
