-- Board contents near the player, kept in step with the server through
-- versioned events, and the DUIs that draw them onto the props.
Content = { cache = {} }

local CONTENT_TIMEOUT = 20000
local DUI_WARMUP = 8000 -- ms to keep resending a new DUI its state
local DUI_RESEND = 750
local DUI_AVAILABLE_TIMEOUT = 10000
-- Same origin as the editor. The page is a module script, which does not load under nui://.
local DUI_URL = ('https://cfx-nui-%s/web/dui.html'):format(cache.resource)
local MAX_REDO = 50
-- A drawn board keeps its DUI this far past the render range, so walking the edge doesn't rebuild it.
local RENDER_MARGIN = 3.0

local fetching = {} -- id -> { waiters, queue }
local visible = {}  -- board id -> view { dui, txd, txn, linked, boardId }, one DUI per drawn board
local pool = {}     -- views no board uses, kept for reuse until Config.Render.idleTimeout
local txdCount = 0
local brightness = 255

local function duiSend(id, message)
    local view = visible[id]
    if view then SendDuiMessage(view.dui, json.encode(message)) end
end

--- Pushes an update to the board's DUI and, if it is open, the editor.
local function publish(id, message)
    duiSend(id, message)
    Editor.Push(id, message)
end

local function mineList(c)
    local out = {}
    for opId in pairs(c.mine) do out[#out + 1] = opId end
    return out
end

local function fullMessage(c)
    return { type = 'full', ops = c.ops, mine = mineList(c), redo = c.redo, bg = c.bg, restorable = c.restorable }
end

local function removeOp(c, opId)
    for i = #c.ops, 1, -1 do
        if c.ops[i].i == opId then
            table.remove(c.ops, i)
            return
        end
    end
end

local apply = {}

function apply.opAdded(c, op, src, clientKey)
    c.ops[#c.ops + 1] = op
    local own = src == cache.serverId
    if own then
        c.mine[op.i] = true
        c.redo = clientKey and 0 or math.max(0, c.redo - 1)
    end
    return { type = 'add', op = op, src = src, mine = own, clientKey = clientKey, redo = c.redo }
end

-- Undone: our own ops go onto the redo stack.
function apply.opRemoved(c, opId)
    removeOp(c, opId)
    if c.mine[opId] then
        c.mine[opId] = nil
        c.redo = math.min(MAX_REDO, c.redo + 1)
    end
    return { type = 'remove', id = opId, redo = c.redo }
end

-- Deleted with the select tool, which can't be redone.
function apply.opDeleted(c, opId)
    removeOp(c, opId)
    c.mine[opId] = nil
    return { type = 'remove', id = opId, redo = c.redo }
end

-- An edited op moves to the front, as it does on the server.
function apply.opUpdated(c, op)
    removeOp(c, op.i)
    c.ops[#c.ops + 1] = op
    return { type = 'update', op = op }
end

function apply.cleared(c, restorable)
    c.ops, c.mine, c.redo, c.restorable = {}, {}, 0, restorable == true
    return { type = 'clear', restorable = c.restorable }
end

function apply.background(c, pattern)
    c.bg = pattern
    return { type = 'background', bg = pattern }
end

--- Applies a versioned change, or queues it while the board is still downloading.
local function handle(id, version, kind, ...)
    local pending = fetching[id]
    if pending then
        pending.queue[#pending.queue + 1] = { version = version, kind = kind, args = { ... } }
        return
    end

    local c = Content.cache[id]
    if not c then return end
    -- The whole board changed, e.g. a clear was undone, so download it again.
    if kind == 'reload' then return Content.Refresh(id) end
    if version ~= c.version + 1 then
        Debug('board #%d missed an update (have v%d, got v%d), refetching', id, c.version, version)
        return Content.Refresh(id)
    end
    c.version = version
    publish(id, apply[kind](c, ...))
end

RegisterNetEvent('butter_whiteboard:client:content', function(id, data)
    local pending = fetching[id]
    if not pending then return end
    fetching[id] = nil

    local c
    local stale = false
    if data then
        c = { version = data.version, ops = data.ops, mine = {}, redo = data.redo or 0, bg = data.bg, restorable = data.restorable == true }
        for _, opId in ipairs(data.mine) do c.mine[opId] = true end
        for _, change in ipairs(pending.queue) do
            if change.kind == 'reload' then
                stale = stale or change.version > c.version
            elseif change.version == c.version + 1 then
                c.version = change.version
                apply[change.kind](c, table.unpack(change.args))
            end
        end
    end
    Content.cache[id] = c

    if c then publish(id, fullMessage(c)) end
    for _, settle in ipairs(pending.waiters) do settle(c) end
    if stale then Content.Refresh(id) end
end)

RegisterNetEvent('butter_whiteboard:client:opAdded', function(id, version, op, src, clientKey)
    handle(id, version, 'opAdded', op, src, clientKey)
end)

RegisterNetEvent('butter_whiteboard:client:opRemoved', function(id, version, opId)
    handle(id, version, 'opRemoved', opId)
end)

RegisterNetEvent('butter_whiteboard:client:opUpdated', function(id, version, op)
    handle(id, version, 'opUpdated', op)
end)

RegisterNetEvent('butter_whiteboard:client:opDeleted', function(id, version, opId)
    handle(id, version, 'opDeleted', opId)
end)

RegisterNetEvent('butter_whiteboard:client:cleared', function(id, version, restorable)
    handle(id, version, 'cleared', restorable)
end)

RegisterNetEvent('butter_whiteboard:client:reload', function(id, version)
    handle(id, version, 'reload')
end)

RegisterNetEvent('butter_whiteboard:client:background', function(id, version, pattern)
    handle(id, version, 'background', pattern)
end)

RegisterNetEvent('butter_whiteboard:client:live', function(id, src, kind, data)
    if not Content.cache[id] then return end
    local message = { type = 'live', src = src, kind = kind, data = data }
    -- Cursors are only shown in the editor, the prop doesn't draw them.
    if kind == 'cursor' then return Editor.Push(id, message) end
    publish(id, message)
end)

RegisterNetEvent('butter_whiteboard:client:liveDropped', function(src)
    for id in pairs(Content.cache) do publish(id, { type = 'live', src = src, kind = 'end' }) end
end)

--- Returns a board's contents, downloading them if they are not cached.
---@return table? content { version, ops, mine, redo, bg }
function Content.Fetch(id)
    local cached = Content.cache[id]
    if cached then return cached end

    local p = promise.new()
    local settled = false
    local function settle(value)
        if settled then return end
        settled = true
        p:resolve(value)
    end

    local pending = fetching[id]
    if pending then
        pending.waiters[#pending.waiters + 1] = settle
    else
        pending = { waiters = { settle }, queue = {} }
        fetching[id] = pending
        TriggerServerEvent('butter_whiteboard:server:requestBoard', id)
    end
    SetTimeout(CONTENT_TIMEOUT, function()
        if settled then return end
        -- Let the next fetch ask the server again instead of joining a dead request.
        if fetching[id] == pending then fetching[id] = nil end
        settle(nil)
    end)
    return Citizen.Await(p)
end

function Content.Refresh(id)
    Content.cache[id] = nil
    CreateThread(function() Content.Fetch(id) end)
end

function Content.Forget(id)
    Content.cache[id] = nil
    -- Anyone still waiting for the download, like an editor being opened, gives up now.
    local pending = fetching[id]
    fetching[id] = nil
    if pending then
        for _, settle in ipairs(pending.waiters) do settle(nil) end
    end
    Content.Release(id)
end

---@return table? message the board's full state as sent to the DUI and editor
function Content.FullMessage(id)
    local c = Content.cache[id]
    return c and fullMessage(c) or nil
end

local duiSettings = json.encode({
    type = 'settings',
    settings = { canvas = Config.Canvas, tools = Config.Tools, images = Config.Images, debug = Config.Debug },
})

local EMPTY_BOARD = { type = 'full', ops = {}, mine = {}, redo = 0 }

--- Sends the settings and current board to a board's page. Safe to repeat,
--- the page rebuilds from scratch each time. A reused DUI still shows its last
--- board, so it is blanked until this board's contents arrive.
local function sendState(id)
    local view = visible[id]
    if not view then return end
    SendDuiMessage(view.dui, duiSettings)
    local c = Content.cache[id]
    duiSend(id, c and fullMessage(c) or EMPTY_BOARD)
end

local function createView()
    local width = Config.Render.resolution
    local height = math.floor(width * Config.Canvas.height / Config.Canvas.width)
    -- Runtime txds can't be removed, so every DUI gets a fresh name. Reusing views keeps this rare.
    txdCount += 1
    local view = {
        dui = CreateDui(DUI_URL, width, height),
        txd = ('butter_whiteboard_%d'):format(txdCount),
        txn = 'board',
        linked = false,
    }

    CreateThread(function()
        -- The handle is not valid until the browser exists, and a texture made
        -- from it earlier stays black.
        local giveUp = GetGameTimer() + DUI_AVAILABLE_TIMEOUT
        while not IsDuiAvailable(view.dui) do
            if view.destroyed then return end
            if GetGameTimer() > giveUp then return print(('^1[butter_whiteboard]^7 DUI %s never became available'):format(view.txd)) end
            Wait(50)
        end
        if view.destroyed then return end
        CreateRuntimeTextureFromDuiHandle(CreateRuntimeTxd(view.txd), view.txn, GetDuiHandle(view.dui))
        view.linked = true
        Debug('DUI %s linked', view.txd)

        -- Messages sent before the page has loaded are lost and there is no
        -- reliable load signal, so keep sending its state for a while.
        local stopAt = GetGameTimer() + DUI_WARMUP
        while not view.destroyed and GetGameTimer() < stopAt do
            if view.boardId then sendState(view.boardId) end
            Wait(DUI_RESEND)
        end
    end)
    return view
end

local function destroyView(view)
    view.destroyed = true
    DestroyDui(view.dui)
end

local startDrawing -- defined below the draw helpers

local CLEAR_PAGE = json.encode({ type = 'clear' })

local function acquire(id)
    local view = table.remove(pool) or createView()
    view.boardId, view.freeSince = id, nil
    visible[id] = view
    if view.linked then
        -- A reused page still holds the last board's live strokes.
        SendDuiMessage(view.dui, CLEAR_PAGE)
        sendState(id)
    end
    startDrawing()
end

function Content.Release(id)
    local view = visible[id]
    if not view then return end
    visible[id] = nil
    view.boardId, view.freeSince = nil, GetGameTimer()
    pool[#pool + 1] = view
end

local function destroyIdle()
    local cutoff = GetGameTimer() - Config.Render.idleTimeout * 1000
    for i = #pool, 1, -1 do
        if pool[i].freeSince < cutoff then destroyView(table.remove(pool, i)) end
    end
end

local function getBrightness()
    if not Config.Render.nightDim then return 255 end
    local h = GetClockHours() + GetClockMinutes() / 60
    local day
    if h >= 7 and h <= 19 then
        day = 1.0
    elseif h > 19 and h < 21 then
        day = (21 - h) / 2
    elseif h > 5 and h < 7 then
        day = (h - 5) / 2
    else
        day = 0.0
    end
    local min = Config.Render.nightBrightness
    return math.floor(255 * (min + (1 - min) * day))
end

local DrawSpritePoly = DrawSpritePoly
local GetFinalRenderedCamCoord = GetFinalRenderedCamCoord
local GetFinalRenderedCamRot = GetFinalRenderedCamRot

-- Half angle of the view cone used to skip off-screen boards. Wider than any
-- real FOV (even 32:9) so a board at the screen edge is never culled.
local VIEW_CONE = math.rad(75.0)

local function drawQuad(view, corners)
    local tl, tr, bl, br = corners[1], corners[2], corners[3], corners[4]
    local b, txd, txn = brightness, view.txd, view.txn
    -- Both windings, so the face shows no matter which way the engine culls.
    -- UVs must be floats: Lua integers reach float native params as garbage (about 0).
    DrawSpritePoly(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, b, b, b, 255, txd, txn, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0)
    DrawSpritePoly(tr.x, tr.y, tr.z, br.x, br.y, br.z, bl.x, bl.y, bl.z, b, b, b, 255, txd, txn, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0)
    DrawSpritePoly(bl.x, bl.y, bl.z, tr.x, tr.y, tr.z, tl.x, tl.y, tl.z, b, b, b, 255, txd, txn, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0)
    DrawSpritePoly(bl.x, bl.y, bl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, b, b, b, 255, txd, txn, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0)
end

--- Camera forward vector, for culling boards outside the view.
local function cameraForward()
    local rot = GetFinalRenderedCamRot(2)
    local rx, rz = math.rad(rot.x), math.rad(rot.z)
    local cx = math.cos(rx)
    return vec3(-math.sin(rz) * cx, math.cos(rz) * cx, math.sin(rx))
end

--- True when a face faces the camera and its bounding sphere is inside the view cone.
---@param d vector3 camera to face centre
local function faceVisible(face, d, fwd)
    local n = face.normal
    if d.x * n.x + d.y * n.y + d.z * n.z >= 0 then return false end
    local len = #d
    if len <= face.radius then return true end
    local cosAngle = (d.x * fwd.x + d.y * fwd.y + d.z * fwd.z) / len
    local angle = math.acos(math.max(-1.0, math.min(1.0, cosAngle)))
    return angle - math.asin(face.radius / len) <= VIEW_CONE
end

local function drawOutline(corners)
    local tl, tr, bl, br = corners[1], corners[2], corners[3], corners[4]
    DrawLine(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, 255, 0, 255, 255)
    DrawLine(tr.x, tr.y, tr.z, br.x, br.y, br.z, 255, 0, 255, 255)
    DrawLine(br.x, br.y, br.z, bl.x, bl.y, bl.z, 255, 0, 255, 255)
    DrawLine(bl.x, bl.y, bl.z, tl.x, tl.y, tl.z, 255, 0, 255, 255)
end

local drawing = false

--- Draws every visible board each frame. The thread only exists while a board
--- is visible, so with none nearby it costs nothing at all.
function startDrawing()
    if drawing then return end
    drawing = true
    CreateThread(function()
        while next(visible) or Config.Debug do
            local cam, fwd = GetFinalRenderedCamCoord(), cameraForward()
            local boards = Boards.list
            for id, view in pairs(visible) do
                local board = boards[id]
                local faces = view.linked and board and not board.hidden and board.faces
                if faces then
                    for i = 1, #faces do
                        local face = faces[i]
                        if faceVisible(face, face.center - cam, fwd) then drawQuad(view, face.corners) end
                    end
                end
            end
            if Config.Debug then
                for _, board in pairs(Boards.list) do
                    for _, face in ipairs(board.faces or {}) do drawOutline(face.corners) end
                end
            end
            Wait(0)
        end
        drawing = false
    end)
end

-- Streaming: keep the closest boards bound to DUIs and their contents cached.
CreateThread(function()
    -- Contents are only kept while the server is still sending us updates.
    local keepRange = Config.Distances.sync - 2.0
    local renderRange = math.min(Config.Distances.render, keepRange)

    while true do
        local pos = GetEntityCoords(cache.ped)
        local near = {}
        local gap = math.huge
        for id, board in pairs(Boards.list) do
            local dist = #(pos - board.coords)
            gap = math.min(gap, dist - renderRange)
            local range = visible[id] and math.min(renderRange + RENDER_MARGIN, keepRange) or renderRange
            -- Faces exist while a prop is spawned, and always for a free panel.
            if board.faces and dist <= range and Boards.InBucket(board) then near[#near + 1] = { id = id, dist = dist } end
            if dist > keepRange and Content.cache[id] and Editor.boardId ~= id then Content.cache[id] = nil end
        end
        table.sort(near, function(a, b) return a.dist < b.dist end)

        local wanted = {}
        for i = 1, math.min(#near, Config.Render.maxActive) do wanted[near[i].id] = true end
        for id in pairs(visible) do
            if not wanted[id] then Content.Release(id) end
        end
        for id in pairs(wanted) do
            if not Content.cache[id] and not fetching[id] then Content.Refresh(id) end
            if not visible[id] then acquire(id) end
        end
        destroyIdle()

        brightness = getBrightness()
        -- Idle DUIs still have to time out, and an open editor keeps its contents fresh.
        Wait((next(pool) or Editor.boardId) and 1000 or IdleSleep(gap, 1000))
    end
end)

if Config.Debug then startDrawing() end

if Config.Debug then
    RegisterCommand('whiteboard_surface', function()
        local closest, closestDist
        local pos = GetEntityCoords(cache.ped)
        for _, board in pairs(Boards.list) do
            local dist = #(pos - board.coords)
            if board.entity and (not closestDist or dist < closestDist) then closest, closestDist = board, dist end
        end
        if not closest then return print('no board nearby') end
        local min, max = GetModelDimensions(joaat(closest.model))
        local s = GetSurface(closest.model)
        print(('board #%d %s\n  model min %s max %s\n  surface size %.2f x %.2f'):format(
            closest.id, closest.model, min, max, s.width, s.height))
        for _, face in ipairs(s.faces) do print(('  face axis %s front %d offset %s'):format(face.axis, face.front, face.offset)) end
    end, false)
end

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    for _, view in pairs(visible) do destroyView(view) end
    for _, view in ipairs(pool) do destroyView(view) end
end)
