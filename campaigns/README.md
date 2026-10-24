# Campaigns

Single-player campaigns, read by the server at start-up (`CAMPAIGNS_DIR` overrides the folder) and re-read whenever the client asks for `GET /api/v1/campaigns`. Broken files are skipped with a `[campaign]` warning in the server log.

```
campaigns/
  <campaign-id>/            folder name is the campaign id (letters, digits, - and _)
    campaign.json
    maps/
      <map-id>.json         file name (without .json) is the map id
```

## campaign.json

| Field | Meaning |
|---|---|
| `name` | Shown in the campaign list |
| `order` | Sort position in the list (lower first; ties by name). Default 100 |
| `summary` | One line under the name in the list |
| `story` | Paragraphs shown on the campaign's own page |
| `maps` | Map ids **in play order**. Levels are unlocked one after another; a missing map file is skipped with a warning |

## maps/<map-id>.json

| Field | Meaning |
|---|---|
| `name` | Level name |
| `briefing.title` / `story[]` / `objectives[]` / `tips[]` | The screen shown before the level. Only `title` and `story` are required |
| `map` | `layout` (`standard`, `open`, `scattered`, `ridges`, `dense`, `citadel`), `width`, `height`, optional `density`, `outposts`, and `seed` (fixed, so the terrain is the same every time) |
| `map.terrain` | Instead of `layout`/`width`/`height`/`density` (`seed` and `outposts` still apply): hand-drawn terrain, an array of equal-length strings of digits (`0` open ground, `1`-`9` rock height), 24-192 each way. Written by `editor/tiled-to-level.mjs` from a Tiled map (see `editor/README.md`); the four start areas are always forced open |
| `victory` | `{ "type": "eliminate" }`: destroy every enemy. The only type so far; winning completes the level and unlocks the next |
| `triggers` | **Reserved, not run yet.** An array of objects with a string `id`; the format is being planned (see `PLAN.md`). The server keeps them and never sends them to the client |

Progress (the furthest level reached in each campaign) is saved in the player's browser, not on the server.
