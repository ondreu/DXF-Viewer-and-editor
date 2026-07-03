/**
 * A minimal but complete R12 (AC1009) DXF document: a HEADER (with drawing
 * units set to millimetres), a TABLES section carrying a LAYER table with the
 * default layer "0", and an empty ENTITIES section. Kept deliberately small yet
 * structurally whole so the editor can immediately draw into it — the parser
 * finds both the ENTITIES ENDSEC (where new entities inject) and the LAYER
 * table ENDTAB (where new layers inject) — and so it round-trips cleanly.
 *
 * Pure data (no Obsidian imports) so the core parser/serializer tests can
 * exercise it directly.
 */
export const NEW_DXF_TEMPLATE =
	[
		"0", "SECTION",
		"2", "HEADER",
		"9", "$ACADVER",
		"1", "AC1009",
		"9", "$INSUNITS",
		"70", "4",
		"0", "ENDSEC",
		"0", "SECTION",
		"2", "TABLES",
		"0", "TABLE",
		"2", "LAYER",
		"70", "1",
		"0", "LAYER",
		"2", "0",
		"70", "0",
		"62", "7",
		"6", "CONTINUOUS",
		"0", "ENDTAB",
		"0", "ENDSEC",
		"0", "SECTION",
		"2", "ENTITIES",
		"0", "ENDSEC",
		"0", "EOF",
	].join("\n") + "\n";
