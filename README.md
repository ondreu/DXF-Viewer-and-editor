# DXF Viewer and Editor

View and lightly edit `.dxf` CAD drawings directly inside Obsidian — as full
file views and as embeds in your notes — on **desktop and mobile**.

This is **v1: DXF only**. DWG is intentionally out of scope (see
[design doc](./obsidian-dxf-plugin-design-doc.md) §2).

> ⚠️ Early release. Editing is limited and the round-trip fidelity of saved
> files is still being hardened across CAD sources. Keep backups of important
> drawings before editing.

## Features

- **File view** — click any `.dxf` in the file explorer to open it in a tab,
  the same way the built-in PDF viewer works.
- **Note embeds** — `![[drawing.dxf]]` renders a read-only viewer inline.
- **Pan / zoom / select** — drag to pan, wheel to zoom, click to select; a
  middle/right-drag always pans, even while a tool is active.
- **Adaptive grid** — a background grid with nice-number spacing that adapts to
  zoom; toggle from the top bar.
- **Snapping** — endpoint, midpoint, centre, quadrant, intersection, **line
  extension** and grid snaps drive measuring, drawing **and moving** (drag a
  grip or an entity body and it snaps to real geometry).
- **Measure** — distance (with Δx/Δy and angle), radius/diameter/circumference,
  three-point angle, area/perimeter of a circle or closed polyline, a
  **traced-polygon area** (click a shape's corners like the polyline draw
  tool, then close it) for regions that aren't already one closed entity, and
  a coordinate readout (ID point) — all shown in a floating readout.
- **Draw** — line, circle (centre+radius, 2-point or 3-point), arc
  (centre+start+end or 3-point), ellipse, **construction lines** (an infinite
  `XLINE` or a semi-infinite `RAY` — guides you can snap other geometry to,
  especially at their intersections), polyline, rectangle, regular polygon
  (any side count), text, a linear dimension, and fill/hatch. Drawn geometry
  becomes **real DXF entities** written back to the file on save. Lines and
  polylines get a soft angle assist near 0/90/180/270°; an **Ortho** toggle in
  the top bar hard-locks to those angles, and pressing `Enter` after the start
  point lets you type an exact angle and length instead of clicking. Text is
  rendered from a **built-in vector stroke font**, so it stays crisp at any
  zoom or entity scale instead of pixelating like a raster texture would
  (lowercase reuses the uppercase letterforms).
- **Editing** — move, copy, rotate, scale, mirror, delete, and change the
  layer/colour of `LINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `LWPOLYLINE`, `HATCH`,
  `TEXT`, `XLINE` and `RAY` entities, with undo/redo.
- **Multi-select** — `Ctrl`/`Cmd`+click to add entities to the selection; drag a
  box over empty space for a CAD-style **window/crossing** rubber-band select
  (left-to-right catches only fully-enclosed entities, right-to-left catches
  anything the box touches); move, copy, rotate, scale, mirror, delete or
  recolour them all at once. A **select-similar** tool picks every entity
  sharing the clicked one's type and layer; a **layer isolate** toggle hides
  everything else (purely a view state — never touches the saved file or the
  undo stack). Select and select-similar sit in their own always-visible
  cluster next to the ribbon tabs, and a **tool stickiness** setting controls
  whether a tool stays active after finishing an action or snaps back to
  Select automatically (AutoCAD-modify-command style).
- **Precise properties** — edit exact position (X/Y), radius, arc start/end
  angles, and text height/rotation/content from the Properties card. Selecting
  multiple entities shows their combined length.
- **Transform tools** — rotate (pick a pivot, spin) with 90° quick-rotate
  buttons, scale (pivot + drag factor), mirror (pick a mirror line) and copy
  (base point + destination), working on single entities or a whole
  multi-selection.
- **Corner tools** — fillet (round a corner between two lines with a tangent
  arc) and chamfer (bevel it with a straight cut), both prompting for the
  radius/distance and trimming the two sides automatically. Works on plain
  LINEs and on the edges of a LWPOLYLINE (e.g. a drawn rectangle's corner) —
  touching a polyline edge explodes that polyline into individual LINEs so the
  corner can hold a curved/trimmed segment. Hovering highlights whatever the
  next click would pick.
- **Trim / extend** — click a cutting edge (line, circle, arc or polyline,
  highlighted on hover), then click a line or arc to trim it back to that
  edge, or a line to stretch it out to a boundary; a dashed preview shows
  exactly what will be trimmed/extended before you commit. Extend only
  stretches a line in the direction it already points — if it's aimed away
  from the boundary, nothing happens.
- **Offset** — click a line, circle or arc, then click a side/distance for a
  parallel copy on the same layer.
- **Join / break / explode** — merge a connected chain of LINEs into one
  polyline, split a LINE/ARC at a clicked point, or explode a polyline back
  into individual line segments.
- **Arrays** — rectangular (columns/rows/spacing) and polar (count + angle
  about a picked centre), both as one grouped undo step.
- **Match properties** — an eyedropper that copies a source entity's
  layer/colour onto others you click.
- **Fill / hatch** — two real-geometry tools: **Fill** solid-fills a closed
  polyline, circle or full ellipse as an actual DXF `HATCH` entity (uses the
  active layer/colour); **Hatch** fills the same kinds of region with parallel
  lines (real `LINE` entities clipped to the boundary), prompting for line
  spacing (scale) and angle. Both use the active layer/colour like every other
  draw tool. A drawing's own pre-existing `HATCH` entities (pattern fills,
  multiple loops, islands) are far more varied than v1 attempts to parse, so
  they still round-trip as an *unsupported* placeholder, same as before.
- **Linear dimension** — click the two points to measure, then place the
  dimension line; builds a real extension-line/arrow/text group (plain
  `LINE`/`LWPOLYLINE`/`TEXT` entities, not a parametric DXF `DIMENSION`) so it
  renders identically everywhere and stays editable with the ordinary tools.
- **Layer management** — add layers and set their colour, linetype and
  lineweight; **hide/show** and **freeze/thaw** layers. Edits are written back
  into the DXF `LAYER` table on save.
- **Correct geometry** — OCS/extrusion (e.g. mirrored `(0,0,-1)` normals) and
  nested/array block INSERTs are transformed to world coordinates, so holes and
  sub-parts land where AutoCAD puts them.
- **Non-destructive saves** — anything the editor doesn't understand (whole
  entity types like `SPLINE`, real `DIMENSION`, a loaded file's own pattern
  `HATCH`, …) is preserved on save and shown as an *unsupported* placeholder,
  never silently discarded.
- **Ribbon toolbar + floating cards** — an AutoCAD-style ribbon: an
  always-visible Select/Select-similar cluster next to a tabbed strip (Measure
  / Draw / Modify / Arrange) of larger icon+label buttons, plus draggable,
  collapsible cards (properties, measurement, layers). All styled from
  Obsidian's own theme variables.

### Interface

- **Ribbon** (top-left): an always-visible **Select** / **Similar** cluster
  (never buried in a tab, and clicking any tab always shows that tab —
  switching tabs never fights the currently active tool), plus tabs —
  **Measure** (distance / radius / angle / area / traced-polygon area / point)
  · **Draw** (line / circle [centre-radius, 2-point, 3-point] / arc
  [centre-based, 3-point] / ellipse / construction line / ray / polyline /
  rectangle / polygon / text / linear dimension / fill / hatch) · **Modify**
  (copy / rotate / scale /
  mirror / fillet / chamfer / trim / extend / offset / join / break /
  explode) · **Arrange** (rectangular array / polar array / match
  properties).
- **Top bar**: fit · grid toggle · snap toggle · ortho toggle · screenshot ·
  undo · redo · delete selection · layer isolate · layers · save (a dot marks
  unsaved changes).
- **Keyboard**: `Esc` cancels the current tool operation, `Enter` finishes a
  polyline (`C` closes it) or, mid-line, opens a prompt to type an exact
  angle/length instead of clicking the end point; arrow keys nudge a
  selection, `Delete` removes it, `Ctrl/Cmd+S` saves, `Ctrl/Cmd+Z` /
  `Shift+Ctrl/Cmd+Z` undo/redo. `Ctrl`/`Cmd`+click extends the selection (also
  works with a drag-select box).

### Supported entities

| Entity | View | Edit |
|---|---|---|
| LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE, HATCH (solid fill only), TEXT, XLINE, RAY | ✅ | ✅ (move / rotate / scale / mirror / delete / layer / colour / dimensions) |
| POLYLINE, MTEXT, INSERT (flattened blocks) | ✅ | — |
| Everything else (including pattern/multi-loop HATCH from other CAD tools) | placeholder marker | preserved on save |

`ELLIPSE` editing covers full ellipses (the common case); a partial
elliptical-arc's trim isn't preserved correctly under **mirror** specifically
(everything else — move/rotate/scale, and mirroring a full ellipse — is exact).

Editing requires an entity to carry a DXF handle (group code 5). Files without
handles remain fully viewable but are read-only.

## Architecture

The codebase keeps a hard boundary between the framework-agnostic core/renderer
and the Svelte UI shell (design doc §3). They communicate only through a typed
event emitter — the renderer never imports Svelte.

```
src/
  core/           framework-agnostic: no Obsidian, no Svelte, no three.js
    parser/       raw DXF tokenizer, dxf-parser wrapper, OCS transforms
    model/        DxfDocument, entity types, ACI colours, raw passthrough store
    command/      reversible command stack (move/delete/layer/colour/draw/batch)
    serializer/   patches edited entities + injects newly drawn ones
    geom/         pure 2D geometry (intersections, fillet/chamfer, hatch lines,
                  ellipse sampling, dimension layout) — independently unit-tested
  render/         three.js 2D renderer (grid, overlay, pan/zoom/pick, vector-font text)
  interaction/    snap engine, tool manager, select/measure/draw/edit tools
  worker/         Web Worker host + inlined parse worker (design doc §6)
  view/           Obsidian file view, note embed, view controller bridge
  ui/             Svelte UI shell (tabbed ribbon + floating cards)
  settings/       Obsidian Setting-API settings tab
```

### Round-trip safety net

The raw DXF is tokenized into `(group code, value)` pairs that are the source of
truth. An **unedited** document re-serializes to a structurally identical tag
stream; only entities you actually change are patched. This is verified by the
automated test suite (`tests/roundtrip.test.ts`, design doc §8.3):

```bash
npm test
```

## Development

```bash
npm install
npm run dev      # watch build -> main.js
npm run build    # type-check + production bundle
npm test         # core + round-trip tests
npm run lint     # eslint with Obsidian rules
```

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/dxf-viewer-editor/` to test in Obsidian.

## Privacy & policy

- **No network access.** Parsing and rendering are fully local and offline.
- **No telemetry.** Nothing is collected or sent anywhere.
- File I/O uses the Obsidian Vault adapter (never Node `fs`), so the plugin runs
  on mobile. `isDesktopOnly` is `false`.

## Known limitations / spikes to verify (design doc §11)

- **Embeds** for custom file extensions depend on Obsidian internals that shift
  between versions — the embed post-processor needs re-verification on a real
  mobile device.
- **Web Worker** behaviour differs on the mobile WebView; the plugin falls back
  to main-thread parsing if a worker can't start, but this needs device testing.
- Binary DXF is detected and rejected (ASCII DXF only in v1).

## Licence

MIT. Depends on [`dxf-parser`](https://github.com/gdsestimating/dxf-parser)
(MIT) and [`three.js`](https://github.com/mrdoob/three.js) (MIT). No GPL
dependencies in v1 (design doc §12).
