# Style guide

The look and feel we are aiming for, so screens added by different people (or agents) match. Colours and component rules are in `packages/client/src/style.css`; this file says what they are *for*. Update it when you set a new convention.

## Overall feel

- A dark, calm, technical interface: a command console over a living map. Nothing bright or noisy except things the player must notice (damage, warnings, wins).
- The menu sits over an animated grid/spark background (`menuBackground.ts`). Content must stay legible over it and must not hide it entirely.
- Font: Electrolize (set on `:root`), 13px base; menus are scaled up (`#lobby` is 1.5em).

## Colour

Use the tokens on `:root`, never raw hex in new code:

| Token | Use |
|---|---|
| `--bg`, `--panel`, `--line` | Page, solid panels and borders |
| `--text`, `--muted` | Body text; secondary text (`<small>`, hints, state labels) |
| `--accent` | Interactive focus and the primary action |
| `--good`, `--bad` | Success / completed; failure / danger |

## Menu screens

- Every menu screen is: a **section head** (`.section-head`: a `← Back` button, then the title) followed by its content inside **one translucent panel**: a `<section>` inside `#lobby`. The `#lobby section` rule gives it the translucent background (alpha 0.5), border, blur, soft dark halo and generous padding (12/14px plus 0.25em all round). Do not put loose content straight on the backdrop.
- Expandable rows that behave like buttons (accordions) are opaque with the button fill (`#1f2630`), not translucent.
- Menu widths: narrow button lists 420px (`.menu-panel`), reading screens up to `900px` (`.campaign-panel`, `.news-panel`; the `.lobby-view` narrows to the panel so the header lines up; use this for any prose), wide forms 900-1100px. Always `min(Npx, 100%)` so phones work.
- Menu choices are big buttons: bold title, a muted one-line description underneath (`.menu-buttons`). The primary action of a screen uses the `primary` class and appears once.
- A screen with two jobs uses glass tabs rather than two columns: a `.glass-tabs` wrapper holding a `.glass-tab-list` (`role="tablist"` of `role="tab"` buttons, `aria-selected` on the open one, arrow keys move between them) and `.glass-tab-panel` blocks, the first tab selected. The tabs are glass like the panels and joined to the panel's top edge (the strip draws that edge, and the open tab has no bottom border, so it flows into the panel); switch panels with `fadeIn` from `transition.ts`, not a slide. The Multiplayer screen is Games, then Create a room.
- Main menu order: Campaigns (dev only), Single-player, Multiplayer, Designer, News and Updates, Options, Manual, Credits. Credits stays last.
- Text shown to players is plain and friendly; no file names or internals. Player-facing updates go in `packages/client/src/changelog.md` (shown as articles in News and Updates): add a `## date` section with a `### headline`, a brief summary (upbeat for good news; plain and careful for breaking or serious changes), then the `- ` change lines.

## Motion

- Screen changes slide and fade (`transition.ts`: `swapContent`, `setShown`, `staggerIn`); a new menu screen is revealed piece by piece (`revealScreen`, applied automatically by `swapContent` in `transition.ts`): the header slides in, each glass panel expands down (150ms), then its contents appear: list rows slide in from the right one after another (70ms apart), anything else fades in. Add new list-row classes to `LIST_ROWS` and new panel kinds to `PANELS` there. A screen with no panel or list slides as a whole. Everything is eased, short (under about 300ms) and never blocks input for long.
- **Reduce motion** (Options; defaults to the system preference) is a hard rule: it must switch off the menu background movement *and* every transition (`reduceMotion()` in `settings.ts`). New animations must go through `transition.ts` or check `reduceMotion()`, and CSS animations need an `html[data-reduce-motion]` override.
- Do not animate the same content twice (for example a loading placeholder followed by a slide). Replace the placeholder in place.
- A list that changes while it is on screen (the Multiplayer room list) keeps one element per item and uses `growRow` / `shrinkRow` from `transition.ts`: new rows open up and fade in, removed rows fade and collapse, the rest update in place. Both do nothing under Reduce motion or when the list is not visible.

## Sound

- Buttons carry `data-sound="..."` (`menu.click`, `menu.back`, `ui.confirm`); use the existing ones. Sound ids and the manifest are in `SOUND_EVENTS.md` and the sound docs.

## Features that are not ready

- Unfinished features are hidden unless the client was built with `WST_DEV_TOOLS=1` (the compile-time constant `__WST_DEV_TOOLS__`, set by `npm run dev`; currently Campaigns, via `devMode()` in `campaignMenu.ts`). Any other build, including every Docker image, never shows them. Do not announce hidden features in the changelog until they go live.
- **Dev Options** (`devTools.ts`): a floating tab on the right of the map that opens a panel of playtest shortcuts. It exists only in a client built with `WST_DEV_TOOLS=1` (`__WST_DEV_TOOLS__` in `main.ts`; any other build contains no trace of it, and the Dockerfile fails the client build if one does) and the server obeys it only with `WST_DEV_TOOLS=1` and never under `NODE_ENV=production`. Add a new playtest shortcut there (a `DevCommand` in `engine/src/net/dev.ts`, handled in `Match.dev`) rather than a hidden hotkey; never mention it in the changelog.
- **Dev Rooms** (`lobbyDevTools.ts`): the same idea for the Multiplayer screen, a sidebar of client-only example rooms for testing the room list. Gated the same way (`__WST_DEV_TOOLS__` in `lobby.ts`); add new menu-side test aids there, and always behind that constant, never `import.meta.env.DEV`.

## Accessibility and robustness

- Real `<button>`s and labelled `<nav>`/`<label>`s; keyboard operable; disabled (not hidden) for things that exist but are unavailable (locked levels).
- Layouts work at phone width with no horizontal page scroll.
- Anything read from `localStorage` is wrapped in try/catch and the screen works without it.
