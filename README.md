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
- **Note embeds** — `![[drawing.dxf]]` renders a read-only viewer inline.
- **Pan / zoom / select** — pointer drag to pan, wheel to zoom, click to select.
- **Light editing** — move, delete, and change the layer/colour of `LINE`,
  `CIRCLE`, `ARC`, `LWPOLYLINE` and `TEXT` entities, with undo/redo.
- **Non-destructive saves** — anything the editor doesn't understand (including
  whole entity types like `HATCH`, `SPLINE`, `DIMENSION`, …) is preserved
  byte-for-structure on save. It is shown as an *unsupported* placeholder, never
  silently discarded.
- **Follows your Obsidian theme** — all colours come from Obsidian's CSS
  variables, so light, dark, and community themes are respected automatically.

### Supported entities

| Entity | View | Edit |
|---|---|---|
| LINE, CIRCLE, ARC, LWPOLYLINE, TEXT | ✅ | ✅ (move / delete / layer / colour) |
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
    parser/       raw DXF tokenizer + dxf-parser wrapper (+ off-thread parse)
    model/        DxfDocument, entity types, ACI colours, raw passthrough store
    command/      reversible command stack (undo/redo)
    serializer/   patches only edited entities back into the raw tag stream
  render/         three.js 2D renderer (orthographic, custom pan/zoom/pick)
  worker/         Web Worker host + inlined parse worker (design doc §6)
  view/           Obsidian file view, note embed, view controller bridge
  ui/             Svelte components (toolbar, property panel, layer panel)
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
