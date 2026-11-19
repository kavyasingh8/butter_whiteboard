Drawing = {}

local MAX_REDO = 50
local LIVE_CHUNK = 200       -- points per live update
local LIVE_PER_SECOND = 40
local REQUEST_LIMIT = 30     -- content requests per player every 10 seconds
local PERM_CACHE_MS = 10000
local RESTORE_SECONDS = 300  -- how long a cleared board can be brought back

local W, H = Config.Canvas.width, Config.Canvas.height
local TOOLS = Config.Tools
local IMAGES = Config.Images
local SHAPES = { line = true, arrow = true, rect = true, ellipse = true }
local DEFAULT_PATTERN = Config.Canvas.patterns[1] or 'plain'
local PATTERNS = {}
for _, p in ipairs(Config.Canvas.patterns) do PATTERNS[p] = true end

local MIN_TEXT, MAX_TEXT = math.huge, 0
for _, s in ipairs(TOOLS.textSizes) do
    MIN_TEXT = math.min(MIN_TEXT, s)
    MAX_TEXT = math.max(MAX_TEXT, s)
end

local MAX_LINES = TOOLS.maxTextLines or 6

local opCounts, liveCounts, requestCounts = {}, {}, {}
local drawCache = {} -- src -> { boardId, allowed, expires }
local names = {}     -- src -> { cid, name }, shown next to their cursor

local function clamp(v, lo, hi)
    return math.max(lo, math.min(hi, v))
end

local function isNumber(v)
    return type(v) == 'number' and v == v and math.abs(v) < 1e6
end

local function isColor(v)
    return type(v) == 'string' and v:match('^#%x%x%x%x%x%x$') ~= nil
end

local function pointCount(op)
    return op.t == 's' and #op.p // 2 or 0
end

local function imageCount(op)
    return op.t == 'i' and 1 or 0
end

---@return number[]? points flat x,y pairs clamped to the canvas
local function cleanPoints(p, max)
    if type(p) ~= 'table' or #p < 2 or #p % 2 ~= 0 or #p > max * 2 then return nil end
    local out = {}
    for i = 1, #p, 2 do
        local x, y = p[i], p[i + 1]
        if not isNumber(x) or not isNumber(y) then return nil end
        out[i] = clamp(math.floor(x + 0.5), -64, W + 64)
        out[i + 1] = clamp(math.floor(y + 0.5), -64, H + 64)
    end
    return out
end

--- Keeps line breaks, every other control character becomes a space.
local function cleanText(v)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('\r\n?', '\n'):gsub('[\0-\9\11-\31\127]', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' or #v > TOOLS.maxTextLength * 4 or utf8.len(v) == nil or utf8.len(v) > TOOLS.maxTextLength then return nil end
    local _, breaks = v:gsub('\n', '')
    if breaks >= MAX_LINES then return nil end
    return v
end

--- Opacity between 0.05 and 1, nil when fully opaque so it isn't stored.
local function cleanAlpha(v)
    if not isNumber(v) then return nil end
    v = clamp(math.floor(v * 100 + 0.5) / 100, 0.05, 1)
    return v < 1 and v or nil
end

local function hostAllowed(host)
    for _, domain in ipairs(IMAGES.domains) do
        if host == domain or host:sub(-(#domain + 1)) == '.' .. domain then return true end
    end
    return false
end

local function cleanUrl(v)
    if type(v) ~= 'string' or #v > IMAGES.maxUrlLength then return nil end
    local host = v:match('^https://([%w%.%-]+)/[^%s"\'<>\\`]*$')
    if not host or not hostAllowed(host:lower()) then return nil end
    return v
end

local function cleanStrokeStyle(op)
    if not isNumber(op.w) or not isColor(op.c) then return nil end
    return op.c:lower(), clamp(math.floor(op.w), TOOLS.minSize, TOOLS.maxSize)
end

--- Whole degrees in (-180, 180], nil when unrotated.
local function cleanAngle(r)
    if not isNumber(r) then return nil end
    r = math.floor(r + 0.5) % 360
    if r > 180 then r -= 360 end
    return r ~= 0 and r or nil
end

local sanitizers = {}

function sanitizers.s(op)
    local p = cleanPoints(op.p, Config.Limits.pointsPerStroke)
    if not p or not isNumber(op.w) then return nil end
    local eraser = op.e == true
    if not eraser and not isColor(op.c) then return nil end
    return {
        t = 's', c = eraser and '#000000' or op.c:lower(), w = clamp(math.floor(op.w), TOOLS.minSize, TOOLS.maxSize),
        e = eraser or nil, a = not eraser and cleanAlpha(op.a) or nil, p = p,
    }
end

function sanitizers.l(op)
    if not SHAPES[op.k] then return nil end
    local p = cleanPoints(op.p, 2)
    if not p or #p ~= 4 then return nil end
    local color, width = cleanStrokeStyle(op)
    if not color then return nil end
    local fill = (op.k == 'rect' or op.k == 'ellipse') and op.fl == true
    return { t = 'l', k = op.k, c = color, w = width, p = p, a = cleanAlpha(op.a), fl = fill or nil }
end

function sanitizers.x(op)
    local text = cleanText(op.v)
    if not text or not isColor(op.c) or not isNumber(op.x) or not isNumber(op.y) or not isNumber(op.s) then return nil end
    local font = math.tointeger(op.f)
    if not font or not TOOLS.fonts[font] then return nil end
    return {
        t = 'x', c = op.c:lower(), v = text, f = font, n = op.n == true or nil, r = cleanAngle(op.r),
        s = clamp(math.floor(op.s), MIN_TEXT, MAX_TEXT),
        x = clamp(math.floor(op.x), 0, W), y = clamp(math.floor(op.y), 0, H),
    }
end

function sanitizers.i(op)
    if not IMAGES.enabled then return nil end
    local url = cleanUrl(op.m)
    if not url or not isNumber(op.x) or not isNumber(op.y) or not isNumber(op.w) or not isNumber(op.h) then return nil end
    local min = IMAGES.minSize
    local w = clamp(math.floor(op.w), min, W)
    local h = clamp(math.floor(op.h), min, H)
    return {
        t = 'i', m = url, w = w, h = h, r = cleanAngle(op.r),
        x = clamp(math.floor(op.x), min - w, W - min),
        y = clamp(math.floor(op.y), min - h, H - min),
    }
end

--- Rebuilds a client op from scratch so nothing unexpected is stored.
---@return table? op
local function sanitize(op)
    if type(op) ~= 'table' then return nil end
    local clean = sanitizers[op.t]
    return clean and clean(op) or nil
end

local function toClient(op)
    return {
        i = op.i, t = op.t, c = op.c, w = op.w, e = op.e, p = op.p, k = op.k, m = op.m,
        v = op.v, f = op.f, s = op.s, x = op.x, y = op.y, h = op.h, r = op.r, a = op.a, fl = op.fl, n = op.n,
    }
end

---@return integer? index
local function findOp(board, opId)
    opId = math.tointeger(opId)
    if not opId then return nil end
    for i = #board.ops, 1, -1 do
        if board.ops[i].i == opId then return i end
    end
end

local function bump(counts, src, limit)
    counts[src] = (counts[src] or 0) + 1
    return counts[src] <= limit
end

--- Op rate limit. The player is told once per second when they go over it.
local function allowOp(src)
    local limit = Config.Limits.opsPerSecond
    local count = (opCounts[src] or 0) + 1
    opCounts[src] = count
    if count == limit + 1 then Notify(src, 'error', 'too_fast') end
    return count <= limit
end

--- Sends an event to everyone near a board, plus `extra` if they are further away.
local function broadcast(board, event, extra, ...)
    local sent = false
    for _, target in ipairs(Boards.PlayersNear(board, Config.Distances.sync)) do
        if target == extra then sent = true end
        TriggerClientEvent(event, target, board.id, ...)
    end
    if extra and not sent then TriggerClientEvent(event, extra, board.id, ...) end
end

--- Drops the in-progress stroke `src` was streaming, e.g. when its op is refused.
local function endLive(board, src)
    broadcast(board, 'butter_whiteboard:client:live', nil, src, 'end')
end

local function changed(board)
    board.updated = os.time()
    board.version += 1
    board.dirty = true
end

---@return table? board, string? reason
local function editableBoard(src, id, action)
    local board = Boards.list[tonumber(id) or -1]
    if not board then return nil, 'missing_board' end
    if not Boards.InBucket(src, board) or #(Boards.PlayerCoords(src) - board.coords) > Config.Distances.edit then return nil, 'too_far' end
    if not Perms.Can(src, action, board) then return nil, 'no_permission' end
    return board
end

local function canDrawLive(src, board)
    local now = GetGameTimer()
    local c = drawCache[src]
    if c and c.boardId == board.id and c.expires > now then return c.allowed end
    local allowed = Boards.InBucket(src, board)
        and #(Boards.PlayerCoords(src) - board.coords) <= Config.Distances.edit
        and Perms.Can(src, 'draw', board)
    -- Only grants are cached, so walking up to a board works straight away.
    drawCache[src] = allowed and { boardId = board.id, allowed = true, expires = now + PERM_CACHE_MS } or nil
    return allowed
end

---@return boolean fits, string? reason
local function fits(board, op)
    if #board.ops >= Config.Limits.maxOps then return false, 'board_full' end
    if board.images + imageCount(op) > IMAGES.maxPerBoard then return false, 'image_limit' end
    if board.points + pointCount(op) > Config.Limits.maxPoints then return false, 'board_full' end
    return true
end

local function track(board, op, sign)
    board.points += pointCount(op) * sign
    board.images += imageCount(op) * sign
end

local function append(board, op)
    board.ops[#board.ops + 1] = op
    track(board, op, 1)
    changed(board)
end

--- Rough board-space box around an op, on the generous side. Used to find
--- eraser strokes that no longer cover anything.
---@return number x0, number y0, number x1, number y1
local function opBox(op)
    if op.t == 's' or op.t == 'l' then
        -- Arrow heads reach about 1.6 widths past the end point.
        local pad = op.t == 'l' and op.w * 1.6 + 8 or op.w / 2 + 1
        local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
        for i = 1, #op.p, 2 do
            x0, x1 = math.min(x0, op.p[i]), math.max(x1, op.p[i])
            y0, y1 = math.min(y0, op.p[i + 1]), math.max(y1, op.p[i + 1])
        end
        return x0 - pad, y0 - pad, x1 + pad, y1 + pad
    end

    local x0, y0, x1, y1
    if op.t == 'x' then
        local longest, lines = 0, 0
        for line in (op.v .. '\n'):gmatch('(.-)\n') do
            longest = math.max(longest, utf8.len(line) or #line)
            lines += 1
        end
        local pad = op.n and op.s * 0.4 or 0
        x0, y0 = op.x - pad, op.y - pad
        x1, y1 = op.x + longest * op.s * 0.8 + pad, op.y + op.s * (1 + (lines - 1) * 1.2) + pad
    else
        x0, y0, x1, y1 = op.x, op.y, op.x + op.w, op.y + op.h
    end
    if not op.r then return x0, y0, x1, y1 end

    -- A turned box stays inside the circle around it.
    local cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    local radius = math.sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2) / 2
    return cx - radius, cy - radius, cx + radius, cy + radius
end

--- Removes eraser strokes that no longer cover anything drawn below them, e.g.
--- after what they erased was moved or deleted, so they stop using up the limits.
local function pruneErasers(board)
    local boxes, removed = {}, {}
    local i = 1
    while i <= #board.ops do
        local op = board.ops[i]
        local x0, y0, x1, y1 = opBox(op)
        local keep = true
        if op.e then
            keep = false
            for _, b in ipairs(boxes) do
                if x0 <= b[3] and x1 >= b[1] and y0 <= b[4] and y1 >= b[2] then
                    keep = true
                    break
                end
            end
        else
            boxes[#boxes + 1] = { x0, y0, x1, y1 }
        end

        if keep then
            i += 1
        else
            table.remove(board.ops, i)
            track(board, op, -1)
            removed[#removed + 1] = op.i
        end
    end

    for _, opId in ipairs(removed) do
        changed(board)
        broadcast(board, 'butter_whiteboard:client:opDeleted', nil, board.version, opId)
    end
end

--- Adds the drawing state to a board loaded from SQL or freshly placed.
---@param content table? decoded content: { bg, ops } or a plain op list from older versions
function Drawing.Attach(board, content)
    content = type(content) == 'table' and content or {}
    local ops = content.ops or content
    board.ops, board.points, board.images, board.seq = {}, 0, 0, 0
    board.bg = PATTERNS[content.bg] and content.bg or DEFAULT_PATTERN
    board.version, board.redo, board.dirty, board.lastClear = 1, {}, false, nil
    for _, op in ipairs(ops) do
        local id = type(op) == 'table' and math.tointeger(op.i)
        if id then
            op.i = id
            board.ops[#board.ops + 1] = op
            track(board, op, 1)
            board.seq = math.max(board.seq, id)
        end
    end
end

--- A board's ops and background as sent to clients, for the admin preview.
---@return table? content { ops, bg }
function Drawing.ClientContent(id)
    local board = Boards.list[id]
    if not board then return nil end
    local ops = {}
    for i, op in ipairs(board.ops) do ops[i] = toClient(op) end
    return { ops = ops, bg = board.bg }
end

--- Forgets cached draw grants for a board, after it was removed or moved.
function Drawing.Detach(id)
    for src, c in pairs(drawCache) do
        if c.boardId == id then drawCache[src] = nil end
    end
end

local function restorable(board)
    return board.lastClear ~= nil and board.lastClear.expires > os.time()
end

---@param src number? player who cleared it, always told even when out of sync range
function Drawing.Clear(id, src)
    local board = Boards.list[id]
    if not board then return false end
    -- Kept for a while so a clear by mistake can be undone.
    if #board.ops > 0 then board.lastClear = { ops = board.ops, expires = os.time() + RESTORE_SECONDS } end
    board.ops, board.points, board.images, board.redo = {}, 0, 0, {}
    changed(board)
    broadcast(board, 'butter_whiteboard:client:cleared', src, board.version, restorable(board))
    return true
end

RegisterNetEvent('butter_whiteboard:server:addOp', function(id, rawOp, clientKey)
    local src = source
    local target = Boards.list[tonumber(id) or -1]
    if not allowOp(src) then
        if target then endLive(target, src) end
        return
    end
    local board, reason = editableBoard(src, id, 'draw')
    if not board then
        if target then endLive(target, src) end
        return Notify(src, 'error', reason)
    end

    local op = sanitize(rawOp)
    if not op then
        endLive(board, src)
        return Notify(src, 'error', type(rawOp) == 'table' and rawOp.t == 'i' and 'image_invalid' or 'op_invalid')
    end
    local ok, full = fits(board, op)
    if not ok then
        endLive(board, src)
        return Notify(src, 'error', full)
    end

    local cid = GetCitizenId(src)
    if not cid then return endLive(board, src) end
    board.seq += 1
    op.i = board.seq
    op.u = cid
    board.redo[cid] = nil
    append(board, op)
    broadcast(board, 'butter_whiteboard:client:opAdded', src, board.version, toClient(op), src, type(clientKey) == 'string' and clientKey:sub(1, 32) or nil)
end)

--- An op its author can change or delete, as can anyone allowed to clear the board.
--- Eraser strokes are not objects of their own, so they can't be picked.
---@return table? board, integer? index, string? reason
local function managedOp(src, id, opId)
    local board, reason = editableBoard(src, id, 'draw')
    if not board then return nil, nil, reason end
    local index = findOp(board, opId)
    local op = index and board.ops[index]
    if not op or op.e then return nil end
    if op.u ~= GetCitizenId(src) and not Perms.Can(src, 'clear', board) then return nil, nil, 'no_permission' end
    return board, index
end

-- Moves, recolours, resizes or rotates an op. It is brought to the front, so
-- eraser strokes from where it was no longer cut into it.
RegisterNetEvent('butter_whiteboard:server:editOp', function(id, opId, rawOp)
    local src = source
    if not allowOp(src) then return end
    local board, index, reason = managedOp(src, id, opId)
    if not board then return reason and Notify(src, 'error', reason) end

    local old = board.ops[index]
    if type(rawOp) ~= 'table' or rawOp.t ~= old.t then return end
    local op = sanitize(rawOp)
    if not op or op.e then return Notify(src, 'error', old.t == 'i' and 'image_invalid' or 'op_invalid') end
    if board.points - pointCount(old) + pointCount(op) > Config.Limits.maxPoints then return Notify(src, 'error', 'board_full') end

    op.i, op.u = old.i, old.u
    table.remove(board.ops, index)
    track(board, old, -1)
    board.ops[#board.ops + 1] = op
    track(board, op, 1)
    changed(board)
    broadcast(board, 'butter_whiteboard:client:opUpdated', src, board.version, toClient(op))
    pruneErasers(board)
end)

RegisterNetEvent('butter_whiteboard:server:deleteOp', function(id, opId)
    local src = source
    if not allowOp(src) then return end
    local board, index, reason = managedOp(src, id, opId)
    if not board then return reason and Notify(src, 'error', reason) end

    local op = table.remove(board.ops, index)
    track(board, op, -1)
    changed(board)
    broadcast(board, 'butter_whiteboard:client:opDeleted', src, board.version, op.i)
    pruneErasers(board)
end)

-- Takes back the player's newest op. Ids only grow, so an op that was moved to
-- the front is not mistaken for the newest one.
RegisterNetEvent('butter_whiteboard:server:undo', function(id)
    local src = source
    if not allowOp(src) then return end
    local board, reason = editableBoard(src, id, 'draw')
    if not board then return Notify(src, 'error', reason) end

    local cid = GetCitizenId(src)
    local index
    for i, op in ipairs(board.ops) do
        if op.u == cid and (not index or op.i > board.ops[index].i) then index = i end
    end
    if not index then return end

    local op = table.remove(board.ops, index)
    track(board, op, -1)
    local stack = board.redo[cid] or {}
    stack[#stack + 1] = op
    if #stack > MAX_REDO then table.remove(stack, 1) end
    board.redo[cid] = stack
    changed(board)
    broadcast(board, 'butter_whiteboard:client:opRemoved', src, board.version, op.i)
end)

RegisterNetEvent('butter_whiteboard:server:redo', function(id)
    local src = source
    if not allowOp(src) then return end
    local board, reason = editableBoard(src, id, 'draw')
    if not board then return Notify(src, 'error', reason) end

    local cid = GetCitizenId(src)
    local stack = board.redo[cid]
    local op = stack and stack[#stack]
    if not op then return end
    local ok, full = fits(board, op)
    if not ok then return Notify(src, 'error', full) end
    stack[#stack] = nil
    append(board, op)
    broadcast(board, 'butter_whiteboard:client:opAdded', src, board.version, toClient(op), src)
end)

RegisterNetEvent('butter_whiteboard:server:clear', function(id)
    local src = source
    local board, reason = editableBoard(src, id, 'clear')
    if not board then return Notify(src, 'error', reason) end
    Drawing.Clear(board.id, src)
    Log('Whiteboard cleared', ('%s cleared board #%d'):format(GetCharacterName(src), board.id))
end)

-- Brings back what the last clear removed, underneath anything drawn since.
RegisterNetEvent('butter_whiteboard:server:restore', function(id)
    local src = source
    if not allowOp(src) then return end
    local board, reason = editableBoard(src, id, 'clear')
    if not board then return Notify(src, 'error', reason) end
    if not restorable(board) then return Notify(src, 'error', 'restore_expired') end

    local merged = {}
    for _, op in ipairs(board.lastClear.ops) do merged[#merged + 1] = op end
    for _, op in ipairs(board.ops) do merged[#merged + 1] = op end

    local points, images = 0, 0
    for _, op in ipairs(merged) do
        points += pointCount(op)
        images += imageCount(op)
    end
    if #merged > Config.Limits.maxOps or points > Config.Limits.maxPoints then return Notify(src, 'error', 'board_full') end
    if images > IMAGES.maxPerBoard then return Notify(src, 'error', 'image_limit') end

    board.ops, board.points, board.images, board.lastClear = merged, points, images, nil
    changed(board)
    broadcast(board, 'butter_whiteboard:client:reload', src, board.version)
    Log('Whiteboard restored', ('%s undid the clear of board #%d'):format(GetCharacterName(src), board.id))
end)

RegisterNetEvent('butter_whiteboard:server:background', function(id, pattern)
    local src = source
    if not allowOp(src) then return end
    if not PATTERNS[pattern] then return end
    local board, reason = editableBoard(src, id, 'clear')
    if not board then return Notify(src, 'error', reason) end
    if board.bg == pattern then return end
    board.bg = pattern
    changed(board)
    broadcast(board, 'butter_whiteboard:client:background', src, board.version, pattern)
end)

local function cleanLive(kind, data)
    if kind == 'start' then
        if type(data) ~= 'table' or not isNumber(data.w) then return nil end
        local eraser = data.e == true
        local p = cleanPoints(data.p, LIVE_CHUNK)
        if not p or (not eraser and not isColor(data.c)) then return nil end
        return {
            c = eraser and '#000000' or data.c, w = clamp(data.w, TOOLS.minSize, TOOLS.maxSize),
            e = eraser or nil, a = not eraser and cleanAlpha(data.a) or nil, p = p,
        }
    end
    if kind == 'move' then return cleanPoints(data, LIVE_CHUNK) end
    if kind == 'shape' then return type(data) == 'table' and sanitizers.l(data) or nil end
end

--- Character name shown next to a player's cursor. Looked up again after a
--- character switch, which does not drop the player.
local function cursorName(src)
    local cid = GetCitizenId(src)
    local cached = names[src]
    if cached and cached.cid == cid then return cached.name end
    local name = GetCharacterName(src)
    names[src] = { cid = cid, name = name }
    return name
end

local function cleanCursor(src, data)
    -- false hides the cursor, e.g. when the player closes the editor.
    if data == false then return false end
    if type(data) ~= 'table' or not isNumber(data[1]) or not isNumber(data[2]) then return nil end
    return { p = { clamp(math.floor(data[1]), 0, W), clamp(math.floor(data[2]), 0, H) }, n = cursorName(src) }
end

-- In-progress strokes, shapes and cursors are relayed and never stored. The
-- finished op arrives through addOp and is validated there.
RegisterNetEvent('butter_whiteboard:server:live', function(id, kind, data)
    local src = source
    if not bump(liveCounts, src, LIVE_PER_SECOND) then return end
    local board = Boards.list[tonumber(id) or -1]
    if not board or not canDrawLive(src, board) then return end

    if kind == 'end' then
        data = nil
    elseif kind == 'cursor' then
        data = cleanCursor(src, data)
        if data == nil then return end
    else
        data = cleanLive(kind, data)
        if not data then return end
    end

    for _, target in ipairs(Boards.PlayersNear(board, Config.Distances.sync)) do
        if target ~= src then TriggerClientEvent('butter_whiteboard:client:live', target, board.id, src, kind, data) end
    end
end)

-- Clients only download boards they are close to. A little past the sync range,
-- since the client keeps a board until just inside it.
local REQUEST_RANGE = Config.Distances.sync + 10.0

RegisterNetEvent('butter_whiteboard:server:requestBoard', function(id)
    local src = source
    if not bump(requestCounts, src, REQUEST_LIMIT) then return end
    local board = Boards.list[tonumber(id) or -1]
    local reachable = board and Boards.InBucket(src, board) and #(Boards.PlayerCoords(src) - board.coords) <= REQUEST_RANGE
    if not reachable then return TriggerClientEvent('butter_whiteboard:client:content', src, tonumber(id), false) end

    local cid = GetCitizenId(src)
    local ops, mine = {}, {}
    for i, op in ipairs(board.ops) do
        ops[i] = toClient(op)
        if cid and op.u == cid then mine[#mine + 1] = op.i end
    end
    local stack = cid and board.redo[cid]
    TriggerLatentClientEvent('butter_whiteboard:client:content', src, ServerConfig.TransferRate, board.id,
        { version = board.version, ops = ops, mine = mine, redo = stack and #stack or 0, bg = board.bg, restorable = restorable(board) })
end)

---@param noWait boolean? queue the write without waiting for it
function Drawing.Save(noWait)
    local rows, saved = {}, {}
    for id, board in pairs(Boards.list) do
        if board.dirty then
            rows[#rows + 1] = { id = id, content = json.encode({ bg = board.bg, ops = board.ops }) }
            saved[#saved + 1] = board
            board.dirty = false
        end
    end
    if #rows == 0 then return end

    local function failed(err)
        print(('^1[butter_whiteboard]^7 failed to save %d board(s): %s'):format(#rows, tostring(err)))
        for _, board in ipairs(saved) do board.dirty = true end
    end

    if noWait then
        return DB.SaveContents(rows, function(ok)
            if not ok then failed('transaction failed') end
        end)
    end

    local ok, result = pcall(DB.SaveContents, rows)
    if not ok or not result then failed(result) end
end

CreateThread(function()
    while true do
        Wait(1000)
        opCounts, liveCounts = {}, {}
    end
end)

CreateThread(function()
    while true do
        Wait(10000)
        requestCounts = {}
    end
end)

CreateThread(function()
    while true do
        Wait(ServerConfig.SaveInterval * 1000)
        Drawing.Save()
    end
end)

AddEventHandler('playerDropped', function()
    local src = source
    drawCache[src] = nil
    names[src] = nil
    TriggerClientEvent('butter_whiteboard:client:liveDropped', -1, src)
end)

-- A scheduled shutdown still lets the save be awaited.
AddEventHandler('txAdmin:events:serverShuttingDown', function()
    Drawing.Save()
end)

-- Awaiting is not possible while the resource stops, so the final save is queued.
-- A failure is still printed if oxmysql gets to answer.
AddEventHandler('onResourceStop', function(resource)
    if resource == cache.resource then Drawing.Save(true) end
end)
