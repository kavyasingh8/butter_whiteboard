Editor = { boardId = nil }

local settings = {
    canvas = Config.Canvas,
    tools = Config.Tools,
    images = Config.Images,
    limits = { pointsPerStroke = Config.Limits.pointsPerStroke },
    nameLength = Config.NameLength,
}

local CAMERA_RAY_FLAGS = 1 | 16 -- world and objects
local CAMERA_MIN_DISTANCE = 0.3
local CAMERA_MAX_FOV = 90.0

local cam
local opening = false

--- How far the camera can back away from `from` towards `to` before hitting
--- something, nil when the way is clear.
---@return number?
local function blockedAt(from, to)
    local handle = StartExpensiveSynchronousShapeTestLosProbe(from.x, from.y, from.z, to.x, to.y, to.z, CAMERA_RAY_FLAGS, cache.ped, 4)
    local _, hit, coords = GetShapeTestResult(handle)
    if hit == 1 or hit == true then return #(coords - from) end
end

--- Puts a camera square in front of the board's surface. Returns where the
--- surface lands on screen as fractions { x, y, w, h }, or nil without zoom.
local function zoomIn(board)
    local cfg = Config.Editor
    if not cfg.zoom or not board.faces then return nil end

    local face = board.faces[1]
    local s = GetBoardSurface(board)
    local center, normal = face.center, face.normal

    -- GTA's camera FOV is vertical. Back off until the surface fits both limits.
    local tanHalf = math.tan(math.rad(cfg.fov) / 2)
    local aspect = GetAspectRatio(false)
    local dist = math.max(s.height / (2 * tanHalf * cfg.fillHeight), s.width / (2 * tanHalf * aspect * cfg.fillWidth))

    -- A wall or ceiling in the way: move in closer and widen the view instead.
    local start = center + normal * 0.05
    local blocked = blockedAt(start, center + normal * dist)
    if blocked then
        dist = math.max(CAMERA_MIN_DISTANCE, blocked - 0.1)
        local needed = math.max(s.height / (2 * dist * cfg.fillHeight), s.width / (2 * dist * aspect * cfg.fillWidth))
        tanHalf = math.min(needed, math.tan(math.rad(CAMERA_MAX_FOV) / 2))
    end
    local fov = math.deg(math.atan(tanHalf)) * 2

    local w = s.width / (2 * dist * tanHalf * aspect)
    local h = s.height / (2 * dist * tanHalf)

    local camPos = center + normal * dist
    cam = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', camPos.x, camPos.y, camPos.z, 0.0, 0.0, 0.0, fov, false, 2)
    PointCamAtCoord(cam, center.x, center.y, center.z)
    SetCamActive(cam, true)
    RenderScriptCams(true, true, cfg.easeTime, true, true)

    -- The ped can stand between the camera and the board.
    CreateThread(function()
        while cam do
            SetEntityLocallyInvisible(cache.ped)
            HideHudAndRadarThisFrame()
            Wait(0)
        end
    end)

    return { x = 0.5 - w / 2, y = 0.5 - h / 2, w = w, h = h }
end

local function zoomOut()
    if not cam then return end
    RenderScriptCams(false, true, Config.Editor.easeTime, true, true)
    DestroyCam(cam, false)
    cam = nil
end

function Editor.Close()
    if not Editor.boardId then return end
    -- Drops a stroke we were in the middle of and hides our cursor for everyone else.
    TriggerServerEvent('butter_whiteboard:server:live', Editor.boardId, 'end')
    TriggerServerEvent('butter_whiteboard:server:live', Editor.boardId, 'cursor', false)
    Editor.boardId = nil
    zoomOut()
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

--- Forwards a board update to the UI when that board is open.
function Editor.Push(id, message)
    if Editor.boardId ~= id then return end
    SendNUIMessage({ action = 'board', data = message })
end

function Editor.BoardRemoved(id)
    if Editor.boardId ~= id then return end
    Editor.Close()
    Notify('inform', 'board_gone')
end

--- Tells the open editor what the player may do now, after a job or ownership change.
function Editor.PermsChanged()
    local id = Editor.boardId
    if not id then return end
    SendNUIMessage({ action = 'perms', data = { id = id, canClear = Perms.Allowed('clear', id), canRename = Perms.Allowed('rename', id) } })
end

--- Where the surface's corners actually land on screen through the active camera,
--- so the editor lines up whatever the real FOV or aspect ratio is.
---@return table? frame { x, y, w, h } as fractions of the screen
local function measureFrame(face)
    local minX, minY, maxX, maxY = math.huge, math.huge, -math.huge, -math.huge
    for _, c in ipairs(face.corners) do
        local onScreen, x, y = GetScreenCoordFromWorldCoord(c.x, c.y, c.z)
        if not onScreen then return nil end
        minX, minY = math.min(minX, x), math.min(minY, y)
        maxX, maxY = math.max(maxX, x), math.max(maxY, y)
    end
    return { x = minX, y = minY, w = maxX - minX, h = maxY - minY }
end

--- Why the editor has to close right now, if it does.
---@return string? reason locale key
local function interruption(id)
    local board = Boards.list[id]
    if not board then return 'board_gone' end
    local ped = cache.ped
    if #(GetEntityCoords(ped) - board.coords) > Config.Distances.edit - 0.5 then return 'walked_away' end
    if not Boards.InBucket(board) or IsEntityDead(ped) or IsPedRagdoll(ped) or IsPedInAnyVehicle(ped, false) then
        return 'editor_closed'
    end
end

local function watch(id)
    CreateThread(function()
        while Editor.boardId == id do
            local reason = interruption(id)
            if reason then
                Editor.Close()
                Notify('inform', reason)
                return
            end
            Wait(500)
        end
    end)
end

function Editor.Open(id)
    local board = Boards.list[id]
    if opening or Editor.boardId or not board or Admin.open or Placement.active then return end

    -- Downloading the board can take a moment, a second open meanwhile is ignored.
    opening = true
    local content = Content.Fetch(id)
    opening = false
    if not content or not Boards.list[id] then return Notify('error', 'load_failed') end
    if Editor.boardId or Admin.open or Placement.active then return end

    Editor.boardId = id
    if board.entity then
        TaskTurnPedToFaceEntity(cache.ped, board.entity, 800)
    else
        TaskTurnPedToFaceCoord(cache.ped, board.coords.x, board.coords.y, board.coords.z, 800)
    end
    local frame = zoomIn(board)
    -- Show the editor once the camera has settled, so it lines up with the surface.
    if frame then
        Wait(Config.Editor.easeTime)
        -- One more frame so the scripted camera is the one being rendered.
        Wait(0)
        if Editor.boardId ~= id then return end
        frame = board.faces and measureFrame(board.faces[1]) or frame
    end
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'open',
        data = {
            boardId = id,
            name = board.name,
            frame = frame,
            settings = settings,
            locale = UiLocale(),
            me = cache.serverId,
            canClear = Perms.Allowed('clear', id),
            canRename = Perms.Allowed('rename', id),
            board = Content.FullMessage(id),
        },
    })
    watch(id)
end

RegisterNUICallback('close', function(_, cb)
    cb(1)
    Editor.Close()
end)

RegisterNUICallback('addOp', function(data, cb)
    cb(1)
    if not Editor.boardId then return end
    TriggerServerEvent('butter_whiteboard:server:addOp', Editor.boardId, data.op, data.key)
end)

RegisterNUICallback('live', function(data, cb)
    cb(1)
    if not Editor.boardId then return end
    TriggerServerEvent('butter_whiteboard:server:live', Editor.boardId, data.kind, data.data)
end)

RegisterNUICallback('editOp', function(data, cb)
    cb(1)
    if not Editor.boardId then return end
    TriggerServerEvent('butter_whiteboard:server:editOp', Editor.boardId, data.id, data.op)
end)

RegisterNUICallback('deleteOp', function(data, cb)
    cb(1)
    if not Editor.boardId then return end
    TriggerServerEvent('butter_whiteboard:server:deleteOp', Editor.boardId, data.id)
end)

RegisterNUICallback('restore', function(_, cb)
    cb(1)
    if Editor.boardId then TriggerServerEvent('butter_whiteboard:server:restore', Editor.boardId) end
end)

RegisterNUICallback('rename', function(data, cb)
    if not Editor.boardId then return cb(false) end
    local ok, reason = lib.callback.await('butter_whiteboard:server:rename', false, Editor.boardId, data.name)
    if not ok then Notify('error', reason or 'failed') end
    cb(ok == true)
end)

--- Tells the open editor a board got a new name.
function Editor.Renamed(id, name)
    if Editor.boardId ~= id then return end
    SendNUIMessage({ action = 'name', data = { id = id, name = name } })
end

RegisterNUICallback('undo', function(_, cb)
    cb(1)
    if Editor.boardId then TriggerServerEvent('butter_whiteboard:server:undo', Editor.boardId) end
end)

RegisterNUICallback('redo', function(_, cb)
    cb(1)
    if Editor.boardId then TriggerServerEvent('butter_whiteboard:server:redo', Editor.boardId) end
end)

RegisterNUICallback('clear', function(_, cb)
    cb(1)
    if Editor.boardId then TriggerServerEvent('butter_whiteboard:server:clear', Editor.boardId) end
end)

RegisterNUICallback('background', function(data, cb)
    cb(1)
    if Editor.boardId then TriggerServerEvent('butter_whiteboard:server:background', Editor.boardId, data.pattern) end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= cache.resource or not Editor.boardId then return end
    SetNuiFocus(false, false)
    zoomOut()
end)
