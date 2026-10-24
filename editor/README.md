# Map editor (Tiled)

Campaign maps can be drawn by hand in [Tiled](https://www.mapeditor.org/) (free, any platform) instead of being generated from a layout and a seed.

## Files

| File | What it is |
|---|---|
| `wst.tiled-project` | Open this in Tiled (File > Open Project). It adds a **Save into a campaign level** command |
| `terrain.tsx`, `terrain.png` | The tileset: 10 tiles, open ground then rock heights 1-9 (3 and up are hatched; the height is also shown as dots) |
| `template.tmj` | A blank 48 x 48 map to copy |
| `maps/*.tmj` | The Tiled maps of the campaign levels drawn this way |
| `tiled-to-level.mjs` | Tiled map -> `map.terrain` in a campaign level file |
| `level-to-tiled.mjs` | Campaign level (or a blank template) -> Tiled map |
| `make-assets.mjs` | Regenerates `terrain.png` and `template.tmj` |

## Workflow

1. Create the level file as usual in `campaigns/<campaign>/maps/<level>.json` (name, briefing, victory) and list it in `campaign.json`. Its `map` can be just `{ "seed": 1 }`.
2. `node editor/level-to-tiled.mjs --new <campaign>/<level>` writes `editor/maps/<level>.tmj`. (Without `--new` it opens a level that already has `map.terrain`.)
3. Open it in Tiled and paint the **terrain** layer with the tileset. Keep the layer named `terrain`, the tileset `terrain.tsx`, and Tile Layer Format on CSV. Size can be changed (Map > Resize Map): 24-192 tiles each way.
4. Save. Run Tiled's **Save into a campaign level** command (or `node editor/tiled-to-level.mjs editor/maps/<level>.tmj`). It writes `map.terrain` into the level file; the map's custom property `level` (`<campaign>/<level>`) says which one. The server re-reads campaigns on every menu visit, so refresh to play it.

## Rules the game applies

- Tile = one map cell. Open ground is height 0; rock is 1-9. Wheels and tracks need open ground, legs climb low rock, colossus legs cross anything, flyers ignore it (see the manual).
- The four start corners are mirrored: each has a base area (about 8 tiles around 8,9; the resource field near 15,13; and 16,16) measured from its own corner. The game forces those areas open so no start is walled in, but keep a route from every corner to the centre. The converter warns when it can't find one.
- Map objects are not used yet: the resource fields, starting units and neutrals are still placed by the game. They are planned together with triggers (see `PLAN.md`).
