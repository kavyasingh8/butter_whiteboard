lib.locale()

Config = {}

-- Outlines every board's drawing surface and enables /whiteboard_surface.
-- Use it to calibrate Config.Models.
Config.Debug = false

-- Board models players can place. The drawing surface is a rectangle in the
-- prop's local space: `offset` is its centre, width and height are in metres.
-- `axis` is the local axis the board faces along, 'x' or 'y' (a fitted surface
-- picks the prop's thinner side). `front` is the side that faces the viewer:
-- 1 for the positive end of that axis, -1 for the negative end.
-- Leave `surface` out to fit it to the model's bounding box automatically,
-- inset by `padding`. The drawing keeps the canvas aspect ratio, so it is
-- centred inside a surface that is wider or taller than 16:9. Set `stretch = true`
-- to fill the whole surface instead, drawings then stretch slightly to fit.
-- If drawings show on the back of a board, set `front = -1`.
-- Check every model in game with Config.Debug before going live.
-- `item` is the item that places a model. Leave it out and only admins can
-- place that model, from the admin panel.
Config.Models = {
    -- Streamed by butter_whiteboard_prop, pushed 2 mm off the board face so the drawing does not flicker.
    {
        label = 'Wall whiteboard',
        model = 'butter_whiteboard_wall',
        item = 'whiteboard_wall',
        axis = 'y',
        front = 1,
        stretch = true,
        surface = { offset = vec3(0.0, 0.0105, 0.62), width = 1.95, height = 1.16 },
    },
    {
        label = 'Standing whiteboard',
        model = 'butter_whiteboard_stand',
        item = 'whiteboard_stand',
        axis = 'y',
        front = 1,
        stretch = true,
        surface = { offset = vec3(0.0, 0.0115, 1.261), width = 1.84, height = 1.02 },
    },
    -- No prop: the board hangs on its own, on a wall or in the air. Its width is
    -- picked while placing, the height follows Config.Canvas so drawings keep their shape.
    {
        label = 'Free panel (no prop)',
        model = 'panel',
        panel = {
            width = 1.6, -- width a new panel starts at
            minWidth = 0.5,
            maxWidth = 6.0,
            doubleSided = true, -- also show the drawing from behind, the right way round
        },
    },
}

-- Using a board moves the camera in front of it and the editor is drawn
-- right over the prop's surface. Set zoom to false for the windowed editor.
Config.Editor = {
    zoom       = true,
    fov        = 40.0,
    fillWidth  = 0.62, -- max share of the screen the board may cover, leaves room for the tool panels
    fillHeight = 0.70,
    easeTime   = 600,  -- ms
}

-- Board pixel size. Every op is stored in these coordinates, so changing it
-- after boards have content will rescale nothing and misplace drawings.
Config.Canvas = {
    width      = 1280,
    height     = 720,
    background = '#f6f7f4',
    -- Ruling drawn under the ink, switchable per board by anyone allowed to clear it.
    -- The first entry is the default for new boards.
    patterns = { 'plain', 'grid', 'lines', 'dots' },
}

Config.Tools = {
    minSize   = 2,
    maxSize   = 48,
    sizes     = { 3, 6, 12, 24 }, -- quick picks in the UI
    textSizes = { 24, 36, 56, 84 },
    maxTextLength = 120,
    maxTextLines  = 6, -- Shift+Enter starts a new line
    highlighterOpacity = 0.35,
    palette = {
        '#111418', '#e03131', '#2f9e44', '#1971c2', '#f08c00',
        '#9c36b5', '#0c8599', '#e64980', '#795548', '#868e96',
    },
    fonts = { 'Inter', 'Permanent Marker', 'Caveat' },
}

-- Images are pinned onto the board from a link. Every nearby player loads the
-- link, so only https links from these hosts (and their subdomains) are accepted.
Config.Images = {
    enabled     = true,
    maxPerBoard = 12,
    maxUrlLength = 400,
    minSize     = 32, -- px on the canvas
    domains = {
        'i.imgur.com',
        'cdn.discordapp.com',
        'media.discordapp.net',
        'r2.fivemanage.com',
        'i.ibb.co',
    },
}

Config.Limits = {
    maxOps          = 2000,   -- strokes, shapes, texts and images per board before it has to be cleared
    maxPoints       = 120000, -- total stroke points per board
    pointsPerStroke = 2500,
    opsPerSecond    = 12,     -- per player, guards against flooding
    boardsPerPlayer = 3,      -- 0 disables the limit, admins are exempt
}

Config.Distances = {
    interact = 2.5,  -- ox_target reach
    edit     = 6.0,  -- server rejects edits from further away than this
    spawn    = 80.0, -- board props exist within this range
    render   = 30.0, -- drawings are shown on the prop within this range
    sync     = 40.0, -- live updates are sent to players within this range
}

Config.Render = {
    maxActive       = 6,    -- boards drawn at once, each one is a DUI
    idleTimeout     = 15,   -- seconds an unused DUI is kept for reuse before it is destroyed
    resolution      = 1024, -- DUI width, height follows the canvas aspect
    nightDim        = true, -- the texture is unlit, so dim it at night
    nightBrightness = 0.5,
}

Config.Placement = {
    maxDistance = 8.0,
    rotateStep  = 5.0,  -- degrees per scroll notch
    heightStep  = 0.02, -- metres per arrow key tick
    maxHeight   = 3.0,  -- max lift above the ground
}

-- Max characters in a board's name. Names are optional and shown in the editor and admin panel.
Config.NameLength = 32

-- Opens the admin panel: every board on the server with a preview, teleport,
-- clear, delete and placing new ones. Admins only (Config.Admin).
Config.AdminCommand = 'whiteboardadmin'

-- Who can do what. Admins can always do everything.
--   everyone: anybody
--   owner:    the character who placed the board
--   jobs:     job name -> minimum grade (on duty only when onDuty is true)
Config.Permissions = {
    draw   = { everyone = true },
    clear  = { owner = true, jobs = { police = 2 } },
    move   = { owner = true },
    remove = { owner = true, jobs = { police = 3 } },
    rename = { owner = true },
    onDuty = false,
}

Config.Admin = {
    ace    = 'command', -- Qbox admins have this by default
    groups = { 'admin', 'god', 'superadmin' }, -- framework groups, 'superadmin' is ESX
}
