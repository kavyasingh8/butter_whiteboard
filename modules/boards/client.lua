Boards = { list = {}, bucket = 0 }

local DESPAWN_MARGIN = 10.0

--- Whether a board was placed in the routing bucket the player is in. Boards
--- from other buckets are neither spawned nor drawn.
function Boards.InBucket(board)
    return board.bucket == Boards.bucket
end

local function despawn(board)
    if board.zone then
        exports.ox_target:removeZone(board.zone)
        board.zone = nil
    end
    if not board.entity then return end
    exports.ox_target:removeLocalEntity(board.entity)
    if DoesEntityExist(board.entity) then DeleteEntity(board.entity) end
    board.entity, board.faces = nil, nil
end

local function confirmRemove(board)
    local answer = lib.alertDialog({
        header = locale('remove_title'),
        content = locale('remove_text'),
        centered = true,
        cancel = true,
    })
    if answer ~= 'confirm' then return end
    local ok, reason = lib.callback.await('butter_whiteboard:server:remove', false, board.id)
    if not ok then return Notify('error', reason or 'failed') end
    Notify('success', 'board_removed')
end

local function targetOptions(board)
    -- A board being moved is only a ghost, it can't be used meanwhile.
    local function allowed(action)
        return not board.hidden and Perms.Allowed(action, board.id)
    end
    return {
        {
            name = 'butter_whiteboard:use',
            icon = 'fa-solid fa-pen-nib',
            label = locale('target_use'),
            distance = Config.Distances.interact,
            canInteract = function() return allowed('draw') end,
            onSelect = function() CreateThread(function() Editor.Open(board.id) end) end,
        },
        {
            name = 'butter_whiteboard:move',
            icon = 'fa-solid fa-up-down-left-right',
            label = locale('target_move'),
            distance = Config.Distances.interact,
            canInteract = function() return allowed('move') end,
            onSelect = function() CreateThread(function() Placement.Move(board.id) end) end,
        },
        {
            name = 'butter_whiteboard:remove',
            icon = 'fa-solid fa-trash',
            label = locale('target_remove'),
            distance = Config.Distances.interact,
            canInteract = function() return allowed('remove') end,
            onSelect = function() CreateThread(function() confirmRemove(board) end) end,
        },
    }
end

--- A free panel has no entity to target, so it gets a box zone over its surface.
local function spawnPanel(board)
    local s = GetPanelSurface(board.width)
    board.zone = exports.ox_target:addBoxZone({
        coords = board.coords,
        size = vec3(s.width, 0.4, s.height),
        rotation = board.heading,
        options = targetOptions(board),
    })
end

--- Streams the model in its own thread, so a slow model doesn't hold up the
--- spawn loop and every other board with it.
local function spawnProp(board, hash)
    board.loading = true
    CreateThread(function()
        local loaded = LoadModel(hash)
        board.loading = nil
        -- Slow to stream in, the next pass of the spawn loop tries again.
        if not loaded then return end
        -- The board may have been removed, moved away or respawned while the model loaded.
        if Boards.list[board.id] ~= board or board.entity or not Boards.InBucket(board) then
            return SetModelAsNoLongerNeeded(hash)
        end

        local entity = CreateObjectNoOffset(hash, board.coords.x, board.coords.y, board.coords.z, false, false, false)
        SetModelAsNoLongerNeeded(hash)
        SetEntityHeading(entity, board.heading)
        FreezeEntityPosition(entity, true)
        SetEntityInvincible(entity, true)
        -- Respawned in the middle of a move, it stays out of sight.
        if board.hidden then SetEntityVisible(entity, false, false) end
        board.entity = entity
        board.faces = GetSurfaceFaces(entity, board.model)
        exports.ox_target:addLocalEntity(entity, targetOptions(board))
    end)
end

local function spawn(board)
    if board.panel then return spawnPanel(board) end
    -- The spawn loop and a freshly placed board can both get here.
    if board.loading or board.entity then return end
    local hash = joaat(board.model)
    if not IsModelInCdimage(hash) or not ModelConfig(board.model) then
        print(('^3[butter_whiteboard]^7 model %s for board #%d does not exist or is not in Config.Models'):format(board.model, board.id))
        board.invalid = true
        return
    end
    spawnProp(board, hash)
end

local function add(data)
    local existing = Boards.list[data.id]
    if existing then despawn(existing) end
    local board = {
        id = data.id,
        name = data.name,
        model = data.model,
        coords = vec3(data.x, data.y, data.z),
        heading = data.heading,
        bucket = data.bucket or 0,
    }
    local cfg = ModelConfig(data.model)
    if cfg and cfg.panel then
        board.panel, board.width = true, data.width
        -- Panels have no entity, their faces only depend on where they are.
        board.faces = GetPanelFaces(board.coords, board.heading, board.width)
    end
    Boards.list[data.id] = board
end

--- Hides a board's prop and drawing, used while it is being moved.
function Boards.SetHidden(id, hidden)
    local board = Boards.list[id]
    if not board then return end
    board.hidden = hidden
    if board.entity then SetEntityVisible(board.entity, not hidden, false) end
end

local function inSpawnRange(board, pos)
    return Boards.InBucket(board) and #(pos - board.coords) <= Config.Distances.spawn
end

-- The spawn loop may be sleeping long when no board was near, so a board placed
-- in range spawns straight away instead of on its next pass.
RegisterNetEvent('butter_whiteboard:client:added', function(data)
    add(data)
    local board = Boards.list[data.id]
    if inSpawnRange(board, GetEntityCoords(cache.ped)) then spawn(board) end
end)

RegisterNetEvent('butter_whiteboard:client:moved', function(data)
    local board = Boards.list[data.id]
    if not board then return add(data) end
    board.coords = vec3(data.x, data.y, data.z)
    board.heading = data.heading
    if board.panel then
        board.width = data.width
        board.faces = GetPanelFaces(board.coords, board.heading, board.width)
        -- Rebuild the target zone at the new spot and size.
        if board.zone then
            despawn(board)
            spawnPanel(board)
        end
        return
    end
    if not board.entity then return end
    SetEntityCoordsNoOffset(board.entity, board.coords.x, board.coords.y, board.coords.z, false, false, false)
    SetEntityHeading(board.entity, board.heading)
    board.faces = GetSurfaceFaces(board.entity, board.model)
end)

RegisterNetEvent('butter_whiteboard:client:renamed', function(id, name)
    local board = Boards.list[id]
    if not board then return end
    board.name = name
    Editor.Renamed(id, name)
end)

RegisterNetEvent('butter_whiteboard:client:removed', function(id)
    local board = Boards.list[id]
    if not board then return end
    Boards.list[id] = nil
    despawn(board)
    Content.Forget(id)
    Editor.BoardRemoved(id)
end)

-- Boards of the bucket we left go away at once, the spawn loop brings in the new ones.
-- No updates arrived while we were elsewhere, so every cached drawing is downloaded again.
RegisterNetEvent('butter_whiteboard:client:bucket', function(bucket)
    if type(bucket) ~= 'number' or bucket == Boards.bucket then return end
    Boards.bucket = bucket
    for id, board in pairs(Boards.list) do
        Content.cache[id] = nil
        if not Boards.InBucket(board) then
            despawn(board)
            Content.Release(id)
        end
    end
end)

CreateThread(function()
    local data = lib.callback.await('butter_whiteboard:server:init', false)
    Boards.bucket = data.bucket or 0
    Perms.Apply(data)
    for _, b in ipairs(data.boards) do add(b) end

    local spawnRange = Config.Distances.spawn
    while true do
        local pos = GetEntityCoords(cache.ped)
        local gap = math.huge
        for _, board in pairs(Boards.list) do
            local inBucket = Boards.InBucket(board)
            local dist = #(pos - board.coords)
            if inBucket then gap = math.min(gap, dist - spawnRange) end
            local spawned = board.entity or board.zone
            if not spawned and not board.invalid and inBucket and dist <= spawnRange then
                spawn(board)
            elseif spawned and (not inBucket or dist > spawnRange + DESPAWN_MARGIN) then
                despawn(board)
            end
        end
        Wait(IdleSleep(gap, 1000))
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource then return end
    for _, board in pairs(Boards.list) do despawn(board) end
end)
