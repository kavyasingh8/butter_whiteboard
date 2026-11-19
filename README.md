# butter_whiteboard

Multiplayer whiteboards for FiveM (Qbox / QBCore). Place a board anywhere, open it with ox_target and draw together. Everything shows up live on the prop itself, so people nearby can watch without opening anything. Boards and their contents are saved in SQL and survive restarts.

## Features

- **Live multiplayer drawing**: strokes and shapes stream to everyone nearby while they are being drawn. Any number of players can draw on the same board at once, and the editor shows how many are drawing right now.
- **Drawn on the prop**: each nearby board is a DUI runtime texture on the prop's surface. Only the closest `Config.Render.maxActive` boards use a DUI.
- **Tools**: smoothed marker with opacity, highlighter, eraser, straight line, arrow, rectangle, ellipse (outlined or filled, hold Shift to snap to 45 degrees or a square/circle), multi-line text with three fonts or as a sticky note, colour palette plus custom colour, brush sizes, undo/redo per player, clear board.
- **Select tool**: pick up any stroke, shape, text or image to move it, recolour it or delete it. Players can change their own work, anyone allowed to clear the board can change everything. A changed item comes to the front, so eraser strokes from where it was no longer cut into it, and eraser strokes left covering nothing are removed.
- **Undo clear**: a cleared board can be brought back for 5 minutes, underneath anything drawn since.
- **Zoom and pan**: scroll to zoom in on the board, right or middle drag to pan.
- **Live cursors**: everyone in the editor sees where the others are pointing, with their character name.
- **Images**: pin a picture to the board from a link. Drag it into place, resize it from the corners (Shift for free resize), then pin it. Only https links from `Config.Images.domains` are accepted.
- **Board backgrounds**: plain, grid, lined (notebook ruling with a margin) or dotted, switchable per board.
- **Boards**: place, move, rotate, raise and remove boards, on the prop or as a free panel with no prop. Each one has its own content and an optional name, set while placing or from the editor.
- **Zoomed editor**: the camera moves in front of the board and you draw right on it.
- **Admin panel**: every board on the server with a preview, teleport, waypoint, rename, clear and delete.
- **Permissions**: draw, clear, move, remove and rename are each configurable by everyone, owner, job and grade. Admins can do everything.
- **Translatable**: every message, including the editor and admin panel, comes from `locales/*.json`.
- **Persistence**: contents are saved in batches every 30 seconds and when the resource stops, not on every stroke.
- Discord webhook logging for place, move, rename, remove, clear and undoing a clear.

## Dependencies

- `ox_lib`, `ox_target`, `oxmysql`
- `butter_whiteboard_prop` (the wall and rolling whiteboard models)
- A framework: `qbx_core`, `qb-core` or `es_extended`
- An inventory for the item: `ox_inventory`, `qb-inventory`, `ps-inventory` or `lj-inventory`
- OneSync (the server reads player positions to scope sync traffic and validate edits)

## Bridges

Frameworks and inventories are detected automatically, there is nothing to configure. The server console lists the bridges in use on start (F8 for the client when `Config.Debug` is on).

```
bridge/<category>/<client|server>/<resource>.lua
```

Each file starts with `if not UseBridge('<category>', '<resource>') then return end`, so it only loads when that exact resource is started. To support another script, copy the closest file, rename it to the resource name and change the guard and the calls inside. Every file in a category defines the same functions:

| Category | Side | Functions |
| --- | --- | --- |
| framework | server | `GetCitizenId`, `GetCharacterName`, `GetJob`, `IsAdmin`, `CreateUsableItem` |
| framework | client | refreshes permissions on character load and job/duty changes |
| inventory | server | `AddItem`, `RemoveItem` |

## Install

1. `ensure butter_whiteboard` after `ox_lib`, `ox_target`, `oxmysql`, `butter_whiteboard_prop` and your framework. The table is created automatically from [`sql/butter_whiteboard.sql`](sql/butter_whiteboard.sql).
2. Add the items from [`[docs]/items.lua`](%5Bdocs%5D/items.lua) with a `whiteboard_wall.png` and `whiteboard_stand.png`. Each model in `Config.Models` names the item that places it with `item = '<name>'`. A model without one, like the free panel, can only be placed by admins from `/whiteboardadmin`. Picking a board back up returns the item it was placed with.
3. Check the board models in game (see below).

### Upgrading from 1.x

Drop-in. Existing boards load as they were. The `width`, `from_item`, `item`, `name` and `bucket` columns are added to the table automatically on start. Boards placed with the old `whiteboard` item give back their model's item when picked up. Boards placed before routing buckets were tracked belong to bucket 0. Contents are saved in the new format (`{ bg, ops }`) the next time a board changes, older rows that are a plain list of ops still load.

Add `rename = { owner = true }` to `Config.Permissions` if you keep your own config, without it only admins can rename boards.

## Editor shortcuts

| Key | Action |
| --- | --- |
| V | Select (drag to move) |
| P / H / E | Marker / highlighter / eraser |
| L / A / R / O | Line / arrow / rectangle / ellipse |
| T | Text (click to place, Shift+Enter for a new line, Enter to finish) |
| I | Add image |
| Shift (while drawing) | Snap lines to 45 degrees, boxes to squares |
| Delete / Backspace | Delete the selected item |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Scroll / right or middle drag | Zoom / pan |
| Enter / Esc | Pin / cancel a pending image |
| Esc | Deselect, then close |

## Images

```lua
Config.Images = {
    enabled     = true,
    maxPerBoard = 12,
    maxUrlLength = 400,
    minSize     = 32,
    domains = { 'i.imgur.com', 'cdn.discordapp.com', 'media.discordapp.net', 'r2.fivemanage.com', 'i.ibb.co' },
}
```

Every player near a board downloads its images, which reveals their IP to the image host. Keep `domains` to hosts you trust. Subdomains of a listed host are allowed. Links must point to the image file itself, not a page that shows it.

Images sit in the drawing like any other op: the eraser rubs over them and undo removes them.

## Board models

`Config.Models` ships with the two `butter_whiteboard_prop` models and a free panel:

| Model | Surface | Placement |
| --- | --- | --- |
| `butter_whiteboard_wall` | 1.95 x 1.15 m, centre 0.60 m up | Aim at a wall and it hangs flat on it |
| `butter_whiteboard_stand` | 1.80 x 1.00 m, centre 1.26 m up | Free standing, scroll to rotate |
| `panel` | Picked while placing, 0.5 to 6 m wide | No prop. Hangs on a wall or stands in the air, visible from both sides |

The drawing is rendered as a quad a few millimetres in front of the prop's surface, so every prop model needs its surface defined:

- `surface = { offset, width, height }` in the prop's local space, or leave it out to fit the model's bounding box (inset by `padding`).
- `axis` is the local axis the board faces along (`'x'` or `'y'`), `front = 1` for its positive end, `-1` for the negative end.

The drawing always keeps the 16:9 canvas shape. On a surface with another shape it is centred and the prop's own white face shows in the gap. The standing board draws on its front side only.

To calibrate:

1. Set `Config.Debug = true` and restart. Every board gets a magenta outline of its drawing surface.
2. Place a board, stand next to it and run `/whiteboard_surface` to print the model bounds and the surface in use (F8).
3. Adjust `offset`, `width`, `height`, `axis` and `front` until the outline sits on the board face, then turn debug off.

## Editor camera

With `Config.Editor.zoom` on, using a board moves the camera square in front of it and the editor's canvas sits exactly over the board's surface, with the tools around it. Turn it off for a windowed editor over the game. `fillWidth` and `fillHeight` limit how much of the screen the board may cover.

## Admin panel

`/whiteboardadmin` (`Config.AdminCommand`, admins only) lists every board on the server with its owner, area, last edit and usage. Pick one to see a live preview, teleport to it, set a waypoint, clear it or delete it, or place a new board from the panel. Every action is checked on the server.

## Placement controls

| Key | Action |
| --- | --- |
| Mouse | Aim |
| Scroll | Rotate |
| Ctrl + scroll | Resize a free panel |
| Arrow up / down | Raise / lower |
| E | Place |
| Backspace / right click | Cancel |

## Permissions

`Config.Permissions` has a rule per action. A rule passes when any of its parts match:

```lua
clear = { owner = true, jobs = { police = 2 } }, -- the board's owner, or police grade 2+
```

- `everyone = true`: anybody
- `owner = true`: the character who placed the board
- `jobs = { name = minGrade }`: on duty only when `Config.Permissions.onDuty` is true

Admins (`Config.Admin`) always pass. Changing a board's background, undoing a clear and editing other players' items use the `clear` rule. Admins can rename any board from the admin panel, everyone else has to be at the board. The item lets anyone holding it place a board, admins can also place one from the admin panel. Removing your own board gives the item back if it was placed with the item.

## How sync works

- A board belongs to the routing bucket it was placed in. Players in other buckets don't see it, can't draw on it and get none of its updates.
- Every board keeps an ordered list of ops (strokes, shapes, texts and images) on the server. Each change bumps a version number and is sent to players within `Config.Distances.sync`.
- Clients download a board's ops once when they get close, then apply changes as they arrive. A missed version triggers a fresh download.
- In-progress strokes, shapes and cursors are relayed and never stored. The finished op is validated and stored on its own. Cursors only go to the editor, not the prop. When the server refuses an op, or the player closes the editor mid-stroke, everyone is told to drop the in-progress stroke, and one that stops updating is dropped after 10 seconds anyway.
- Clients can only download boards near them. Moving, renaming and removing a board need the player at the board, except renaming from the admin panel. A move starts at the board, after that the player can carry it up to 5 minutes before placing it.
- The server rebuilds every op from scratch (colour, size, points, shape kind, text, font, image link and bounds) and rate limits ops, live updates and downloads per player. Limits per board are in `Config.Limits`.

## Translating

Copy `locales/en.json` to your language code (for example `locales/de.json`) and translate it. The `ui` section holds the editor and admin panel strings, `%s` is filled in by the UI. ox_lib picks the file from your server's locale setting and falls back to English for anything missing.

## Building the UI

```bash
cd web-source
npm install
npm run build
```

The build outputs `web/index.html` (the editor) and `web/dui.html` (the page drawn onto the props). `npm run dev` runs the editor in a browser with mock data and a fake second player.

## Exports (server)

```lua
exports.butter_whiteboard:GetBoards()      -- all boards (name, owner, model, coords, op count)
exports.butter_whiteboard:ClearBoard(id)   -- true if cleared
```
