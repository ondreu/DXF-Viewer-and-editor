# DXF Viewer & Editor for Obsidian

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
- **Note embeds** — `![[drawing.dxf]]` renders a read-only viewer inline
  (annotations included).
- **Pan / zoom / select** — drag to pan, wheel to zoom, click to select; a
  middle/right-drag always pans, even while a tool is active.
- **Adaptive grid** — a background grid with nice-number spacing that adapts to
  zoom; toggle from the top bar.
- **Snapping** — endpoint, midpoint, centre, quadrant, intersection, **line
  extension** and grid snaps drive measuring, drawing **and moving** (drag a
  grip, an entity body, or a note and it snaps to real geometry).
- **Measure** — distance (with Δx/Δy and angle), radius/diameter/circumference,
  and three-point angle, shown in a floating readout. Measurements can be saved
  as visible annotations.
- **Draw** — line, circle, **arc**, polyline, **rectangle** and text. Drawn
  geometry becomes **real DXF entities** written back to the file on save.
- **Editing** — move, copy, rotate, scale, mirror, delete, and change the
  layer/colour of `LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE` and `TEXT` entities,
  with undo/redo.
- **Multi-select** — `Ctrl`/`Cmd`+click to add entities to the selection; move,
  copy, rotate, scale, mirror, delete or recolour them all at once.
- **Precise properties** — edit exact position (X/Y), radius, arc start/end
  angles, and text height/rotation/content from the Properties card.
- **Transform tools** — rotate (pick a pivot, spin) with 90° quick-rotate
  buttons, scale (pivot + drag factor), mirror (pick a mirror line) and copy
  (base point + destination), working on single entities or a whole
  multi-selection.
- **Layer management** — add layers and set their colour, linetype and
  lineweight; **hide/show** and **freeze/thaw** layers. Edits are written back
  into the DXF `LAYER` table on save.
- **Annotations** — drop notes and save measurements as markup stored in a
  **sidecar JSON** (`<drawing>.dxf.annotations.json`); the `.dxf` is never
  touched by annotations.
- **Correct geometry** — OCS/extrusion (e.g. mirrored `(0,0,-1)` normals) and
  nested/array block INSERTs are transformed to world coordinates, so holes and
  sub-parts land where AutoCAD puts them.
- **Non-destructive saves** — anything the editor doesn't understand (whole
  entity types like `HATCH`, `SPLINE`, `DIMENSION`, …) is preserved on save and
  shown as an *unsupported* placeholder, never silently discarded.
- **Icon tool palette + floating cards** — a left-hand tool palette and
  draggable, collapsible cards (properties, measurement, layers, annotations)
  instead of a fixed sidebar. All styled from Obsidian's own theme variables.

### Interface

- **Left palette**: select · measure (distance / radius / angle) · draw (line /
  circle / arc / polyline / rectangle / text) · copy / rotate / scale / mirror ·
  note.
- **Top bar**: fit · grid toggle · snap toggle · screenshot · undo · redo ·
  delete selection · layers · annotations · save (a dot marks unsaved changes).
- **Keyboard**: `Esc` cancels the current tool operation, `Enter` finishes a
  polyline (`C` closes it), arrow keys nudge a selection, `Delete` removes it,
  `Ctrl/Cmd+S` saves, `Ctrl/Cmd+Z` / `Shift+Ctrl/Cmd+Z` undo/redo. `Ctrl`/`Cmd`
  +click extends the selection.

### Supported entities

| Entity | View | Edit |
|---|---|---|
| LINE, CIRCLE, ARC, LWPOLYLINE, TEXT | ✅ | ✅ (move / rotate / delete / layer / colour / dimensions) |
| POLYLINE, MTEXT, INSERT (flattened blocks) | ✅ | — |
| Everything else | placeholder marker | preserved on save |

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
    command/      reversible command stack (move/delete/layer/colour/draw)
    serializer/   patches edited entities + injects newly drawn ones
    annotation/   sidecar annotation store (notes / measurements / markup)
  render/         three.js 2D renderer (grid, overlay, pan/zoom/pick)
  interaction/    snap engine, tool manager, select/measure/draw/annotate tools
  worker/         Web Worker host + inlined parse worker (design doc §6)
  view/           Obsidian file view, note embed, view controller bridge
  ui/             Svelte UI shell (tool palette + floating cards)
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
