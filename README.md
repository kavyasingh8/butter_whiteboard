# butter_whiteboard

Multiplayer whiteboards for FiveM. Place a board, open it with ox_target and draw together in real time. Drawings show live on the prop and are saved in SQL.

## Features

- Live multiplayer drawing with marker, highlighter, eraser, shapes, text, sticky notes and images
- Drawings rendered directly on the prop, visible to nearby players
- Wall board, standing board and a free panel with no prop
- Select, move, recolour and delete items, undo/redo, undo clear
- Admin panel (`/whiteboardadmin`) to view, teleport to, rename, clear and delete boards
- Configurable permissions per action (everyone, owner, job and grade)
- Discord webhook logging
- Translatable through `locales/*.json`

## Dependencies

- `ox_lib`, `ox_target`, `oxmysql`
- [`butter_whiteboard_prop`](https://github.com/kavyasingh8/butter_whiteboard_prop)
- Framework: `qbx_core`, `qb-core` or `es_extended`
- Inventory: `ox_inventory` or `qb-inventory`
- OneSync

## Install

1. Add `ensure butter_whiteboard` after its dependencies. The SQL table is created automatically.
2. Add the items from [`[docs]/items.lua`](%5Bdocs%5D/items.lua) and the images from `[docs]/images` to your inventory.
3. Adjust `config/shared.lua` and `config/server.lua` as needed.

## Configuration

- `config/shared.lua`: board models, editor camera, images, permissions, limits
- `config/server.lua`: save interval, webhook, version check

Set `Config.Debug = true` and use `/whiteboard_surface` to calibrate the drawing surface of custom models.
