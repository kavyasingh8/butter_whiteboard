Boards = { list = {}, ready = false }

local MODELS = {} -- model -> config
for _, m in ipairs(Config.Models) do MODELS[m.model] = m end

-- item -> models it places. Models without an item are admin only.
local ITEM_MODELS = {} ---@type table<string, string[]>
for _, m in ipairs(Config.Models) do
    if m.item then
        ITEM_MODELS[m.item] = ITEM_MODELS[m.item] or {}
        table.insert(ITEM_MODELS[m.item], m.model)
    end
end

---@class Placing
---@field via 'item' | 'admin'
---@field item string? item spent when the board is placed
---@field models table<string, true>? models allowed, nil for any

local placing = {} ---@type table<number, Placing>

function Notify(src, type, key, ...)
    TriggerClientEvent('ox_lib:notify', src, { type = type, description = locale(key, ...) })
end

function Log(title, message)
    if ServerConfig.Webhook == '' then return end
    PerformHttpRequest(ServerConfig.Webhook, function() end, 'POST', json.encode({
        username = 'butter_whiteboard',
        embeds = { { title = title, description = message, color = 16312092 } },
    }), { ['Content-Type'] = 'application/json' })
end

local function isNumber(v)
    return type(v) == 'number' and v == v and math.abs(v) < 100000
end

function Boards.PlayerCoords(src)
    return GetEntityCoords(GetPlayerPed(src))
end

--- Whether a player is in the routing bucket the board was placed in.
function Boards.InBucket(src, board)
    return GetPlayerRoutingBucket(src) == board.bucket
end

local NEAR_CACHE_MS = 500

--- Players within `range` of a board and in its routing bucket, used to scope
--- sync traffic. Live strokes call this many times a second, so the scan over
--- every player is cached briefly.
function Boards.PlayersNear(board, range)
    local now = GetGameTimer()
    local cache = board.near
    if cache and cache.range == range and cache.expires > now then return cache.list end

    local out = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if Boards.InBucket(src, board) and #(Boards.PlayerCoords(src) - board.coords) <= range then out[#out + 1] = src end
    end
    board.near = { range = range, expires = now + NEAR_CACHE_MS, list = out }
    return out
end

-- Only what clients need to spawn it. Ownership stays on the server.
function Boards.ToClient(b)
    return { id = b.id, name = b.name, model = b.model, x = b.coords.x, y = b.coords.y, z = b.coords.z, heading = b.heading, width = b.width, bucket = b.bucket }
end

--- A board name from a client. Control characters are dropped and an empty
--- name clears it.
---@return boolean ok, string? name
local function cleanName(v)
    if v == nil then return true, nil end
    if type(v) ~= 'string' or #v > Config.NameLength * 4 then return false end
    v = v:gsub('%c', ''):gsub('^%s+', ''):gsub('%s+$', '')
    local length = utf8.len(v)
    if not length or length > Config.NameLength then return false end
    return true, v ~= '' and v or nil
end

local function ownedIds(src)
    local cid = GetCitizenId(src)
    local out = {}
    if not cid then return out end
    for id, b in pairs(Boards.list) do
        if b.owner == cid then out[#out + 1] = id end
    end
    return out
end

local function countOwned(cid)
    local n = 0
    for _, b in pairs(Boards.list) do
        if b.owner == cid then n += 1 end
    end
    return n
end

--- Free panels also need a width within the configured range, other boards ignore it.
---@return boolean ok, string? reason
local function validatePosition(src, model, coords, heading, width)
    if not MODELS[model] then return false, 'invalid_model' end
    local panel = MODELS[model].panel
    if panel and (not isNumber(width) or width < panel.minWidth or width > panel.maxWidth) then return false, 'invalid_size' end
    if type(coords) ~= 'table' and type(coords) ~= 'vector3' then return false, 'invalid_position' end
    if not isNumber(coords.x) or not isNumber(coords.y) or not isNumber(coords.z) or not isNumber(heading) then
        return false, 'invalid_position'
    end
    local pos = vec3(coords.x, coords.y, coords.z)
    if #(Boards.PlayerCoords(src) - pos) > Config.Placement.maxDistance + 2.0 then return false, 'too_far' end
    return true
end

--- A placement already under way keeps its source, so an item is never spent
--- on a board started from the admin panel or the other way round.
---@param item string? the item used, limits the models to the ones it places
function Boards.StartPlacement(src, via, item)
    if placing[src] then return Notify(src, 'error', 'already_placing') end
    local list = item and ITEM_MODELS[item]
    local models
    if list then
        models = {}
        for _, model in ipairs(list) do models[model] = true end
    end
    placing[src] = { via = via, item = item, models = models }
    TriggerClientEvent('butter_whiteboard:client:startPlacement', src, list)
end

CreateThread(function()
    if not CreateUsableItem then return end
    for item in pairs(ITEM_MODELS) do
        CreateUsableItem(item, function(src) Boards.StartPlacement(src, 'item', item) end)
    end
end)

RegisterNetEvent('butter_whiteboard:server:cancelPlacement', function()
    placing[source] = nil
end)

lib.callback.register('butter_whiteboard:server:place', function(src, model, coords, heading, width, rawName)
    local pending = placing[src]
    if not pending then return false end
    local via, item = pending.via, pending.item
    if pending.models and not pending.models[model] then return false, 'invalid_model' end

    local ok, reason = validatePosition(src, model, coords, heading, width)
    if not ok then return false, reason end
    local validName, name = cleanName(rawName)
    if not validName then return false, 'invalid_name' end

    local cid = GetCitizenId(src)
    if not cid then return false end
    local admin = IsAdmin(src)
    local limit = Config.Limits.boardsPerPlayer
    if not admin and limit > 0 and countOwned(cid) >= limit then return false, 'board_limit' end
    if via == 'admin' and not admin then return false, 'no_permission' end
    if item and not (RemoveItem and RemoveItem(src, item)) then return false, 'no_item' end

    placing[src] = nil
    local board = {
        owner = cid,
        ownerName = GetCharacterName(src),
        name = name,
        model = model,
        coords = vec3(coords.x, coords.y, coords.z),
        heading = heading % 360.0,
        width = MODELS[model].panel and width or nil,
        item = item,
        bucket = GetPlayerRoutingBucket(src),
    }
    local id = DB.Insert(board)
    if not id then
        if item and AddItem then AddItem(src, item) end
        return false, 'save_failed'
    end

    board.id = id
    board.updated = os.time()
    Drawing.Attach(board, {})
    Boards.list[id] = board
    TriggerClientEvent('butter_whiteboard:client:added', -1, Boards.ToClient(board))
    TriggerClientEvent('butter_whiteboard:client:owned', src, id)
    Log('Whiteboard placed', ('%s placed board #%d (%s)'):format(board.ownerName, id, model))
    return true, id
end)

--- Whether a player is standing at a board, close enough to edit it.
local function atBoard(src, board)
    return Boards.InBucket(src, board) and #(Boards.PlayerCoords(src) - board.coords) <= Config.Distances.edit
end

local MOVE_SECONDS = 300 -- how long a started move may take
local moving = {} -- src -> { id, expires }, a move the player started at the board

-- A move starts at the board. The player may walk while carrying it, so the
-- end of the move only needs them near the new spot.
lib.callback.register('butter_whiteboard:server:startMove', function(src, id)
    local board = Boards.list[id]
    if not board then return false, 'missing_board' end
    if not Perms.Can(src, 'move', board) then return false, 'no_permission' end
    if not atBoard(src, board) then return false, 'too_far' end
    moving[src] = { id = id, expires = os.time() + MOVE_SECONDS }
    return true
end)

lib.callback.register('butter_whiteboard:server:move', function(src, id, coords, heading, width)
    local started = moving[src]
    moving[src] = nil
    local board = Boards.list[id]
    if not board then return false, 'missing_board' end
    if not Perms.Can(src, 'move', board) then return false, 'no_permission' end
    if not started or started.id ~= id or started.expires < os.time() then return false, 'too_far' end
    if not Boards.InBucket(src, board) then return false, 'too_far' end
    local ok, reason = validatePosition(src, board.model, coords, heading, width)
    if not ok then return false, reason end

    local pos = vec3(coords.x, coords.y, coords.z)
    width = MODELS[board.model].panel and width or nil
    if not DB.SetPosition(id, pos, heading % 360.0, width) then return false, 'save_failed' end
    board.coords = pos
    board.near = nil
    board.heading = heading % 360.0
    board.width = width
    Drawing.Detach(id)
    TriggerClientEvent('butter_whiteboard:client:moved', -1, Boards.ToClient(board))
    Log('Whiteboard moved', ('%s moved board #%d placed by %s'):format(GetCharacterName(src), id, board.ownerName))
    return true
end)

-- Admins can rename from anywhere through the admin panel, everyone else has to be at the board.
lib.callback.register('butter_whiteboard:server:rename', function(src, id, rawName)
    local board = Boards.list[tonumber(id) or -1]
    if not board then return false, 'missing_board' end
    if not Perms.Can(src, 'rename', board) then return false, 'no_permission' end
    if not IsAdmin(src) and not atBoard(src, board) then return false, 'too_far' end
    local ok, name = cleanName(rawName)
    if not ok then return false, 'invalid_name' end
    if name == board.name then return true, 'board_renamed' end

    if not DB.SetName(board.id, name) then return false, 'save_failed' end
    board.name = name
    TriggerClientEvent('butter_whiteboard:client:renamed', -1, board.id, name)
    Log('Whiteboard renamed', ('%s renamed board #%d to "%s"'):format(GetCharacterName(src), board.id, name or ''))
    return true, 'board_renamed'
end)

--- Deletes a board everywhere. Checks are up to the caller.
function Boards.Delete(id)
    if not DB.Delete(id) then return false end
    Boards.list[id] = nil
    Drawing.Detach(id)
    TriggerClientEvent('butter_whiteboard:client:removed', -1, id)
    return true
end

lib.callback.register('butter_whiteboard:server:remove', function(src, id)
    local board = Boards.list[id]
    if not board then return false, 'missing_board' end
    if not Perms.Can(src, 'remove', board) then return false, 'no_permission' end
    if not atBoard(src, board) then return false, 'too_far' end
    if not Boards.Delete(id) then return false, 'save_failed' end

    if board.item and AddItem and board.owner == GetCitizenId(src) then AddItem(src, board.item) end
    Log('Whiteboard removed', ('%s removed board #%d placed by %s'):format(GetCharacterName(src), id, board.ownerName))
    return true
end)

lib.callback.register('butter_whiteboard:server:init', function(src)
    while not Boards.ready do Wait(100) end
    local boards = {}
    for _, b in pairs(Boards.list) do boards[#boards + 1] = Boards.ToClient(b) end
    return { boards = boards, owned = ownedIds(src), perms = Perms.Summary(src), bucket = GetPlayerRoutingBucket(src) }
end)

lib.callback.register('butter_whiteboard:server:perms', function(src)
    return { owned = ownedIds(src), perms = Perms.Summary(src) }
end)

local buckets = {} -- src -> routing bucket the client was last told about

-- Clients can't read their own routing bucket, so they are told when it changes
-- and only show the boards placed in theirs.
CreateThread(function()
    while true do
        Wait(2000)
        for _, id in ipairs(GetPlayers()) do
            local src = tonumber(id)
            local bucket = GetPlayerRoutingBucket(src)
            if buckets[src] ~= bucket then
                buckets[src] = bucket
                TriggerClientEvent('butter_whiteboard:client:bucket', src, bucket)
            end
        end
    end
end)

AddEventHandler('playerDropped', function()
    placing[source] = nil
    moving[source] = nil
    buckets[source] = nil
end)

CreateThread(function()
    DB.Init()
    for _, row in ipairs(DB.LoadAll()) do
        local board = {
            id = row.id,
            owner = row.owner,
            ownerName = row.owner_name,
            name = row.name,
            model = row.model,
            coords = vec3(row.x, row.y, row.z),
            heading = row.heading,
            updated = row.updated,
            -- Boards placed before per-model items only recorded that an item was
            -- used, so they give back their model's item.
            item = row.item or ((row.from_item == 1 or row.from_item == true) and MODELS[row.model] and MODELS[row.model].item or nil),
            bucket = row.bucket or 0,
        }
        local panel = MODELS[row.model] and MODELS[row.model].panel
        if panel then board.width = row.width > 0 and row.width or panel.width end
        local ok, content = pcall(json.decode, row.content or '[]')
        if not ok or type(content) ~= 'table' then
            print(('^3[butter_whiteboard]^7 board #%d has unreadable content, starting it empty'):format(row.id))
            content = {}
        end
        Drawing.Attach(board, content)
        Boards.list[row.id] = board
    end
    Boards.ready = true
end)

exports('GetBoards', function()
    local out = {}
    for _, b in pairs(Boards.list) do
        out[#out + 1] = { id = b.id, name = b.name, owner = b.owner, ownerName = b.ownerName, model = b.model, coords = b.coords, heading = b.heading, width = b.width, ops = #b.ops }
    end
    return out
end)

exports('ClearBoard', function(id)
    if not Drawing.Clear(id) then return false end
    Log('Whiteboard cleared', ('board #%d was cleared by %s'):format(id, GetInvokingResource() or 'unknown'))
    return true
end)
