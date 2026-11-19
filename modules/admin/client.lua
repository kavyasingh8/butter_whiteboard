-- Admin panel NUI. Shares the page with the editor, only one is open at a time.
Admin = { open = false }

local TELEPORT_GAP = 2.5 -- metres in front of the board's face

local modelLabels = {}
for _, m in ipairs(Config.Models) do modelLabels[m.model] = m.label end

local settings = {
    canvas = Config.Canvas,
    tools = Config.Tools,
    images = Config.Images,
    models = modelLabels,
    nameLength = Config.NameLength,
}

local function areaName(x, y, z)
    local street = GetStreetNameFromHashKey(GetStreetNameAtCoord(x, y, z))
    local zone = GetLabelText(GetNameOfZone(x, y, z))
    if street == '' then return zone end
    return ('%s, %s'):format(street, zone)
end

---@return table? view { boards, now, limits }
local function fetchList()
    local view = lib.callback.await('butter_whiteboard:server:adminList', false)
    if not view then return nil end
    for _, b in ipairs(view.boards) do b.area = areaName(b.x, b.y, b.z) end
    return view
end

function Admin.Open()
    if Admin.open or Editor.boardId or Placement.active then return end
    local view = fetchList()
    if not view then return Notify('error', 'no_permission') end
    Admin.open = true
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'admin', data = { settings = settings, view = view, locale = UiLocale() } })
end

function Admin.Close()
    if not Admin.open then return end
    Admin.open = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

--- Where to stand to face a board's drawing, worked out from its config so it
--- also works for boards that are not spawned nearby.
local function standSpot(board)
    local surface = GetBoardSurface(board)
    -- A board whose model was taken out of Config.Models has no surface.
    if not surface then return board.coords + vec3(0.0, 0.0, 1.0), board.heading end
    local face = surface.faces[1]
    local r = math.rad(board.heading)
    local c, s = math.cos(r), math.sin(r)
    local function rotate(v) return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z) end
    local normal = rotate(face.normal)
    local center = board.coords + rotate(face.offset)
    local pos = center + normal * TELEPORT_GAP
    local heading = math.deg(math.atan(normal.x, -normal.y)) % 360.0
    return pos, heading
end

RegisterNetEvent('butter_whiteboard:client:openAdmin', Admin.Open)

---@param busy boolean? the server is rate limiting previews, the panel asks again
RegisterNetEvent('butter_whiteboard:client:adminPreview', function(id, content, busy)
    if not Admin.open then return end
    content = content or {}
    SendNUIMessage({ action = 'adminPreview', data = { id = id, ops = content.ops or {}, bg = content.bg, missing = not busy and not content.ops, busy = busy == true } })
end)

RegisterNUICallback('adminClose', function(_, cb)
    cb(1)
    Admin.Close()
end)

RegisterNUICallback('adminRefresh', function(_, cb)
    cb(fetchList() or false)
end)

RegisterNUICallback('adminPreview', function(data, cb)
    cb(1)
    TriggerServerEvent('butter_whiteboard:server:adminPreview', data.id)
end)

--- Runs an admin action, notifies the result and returns a fresh list.
local function action(cb, name, ...)
    local ok, reason = lib.callback.await(name, false, ...)
    if reason then Notify(ok and 'success' or 'error', reason) end
    cb({ ok = ok == true, view = fetchList() })
end

RegisterNUICallback('adminRename', function(data, cb)
    action(cb, 'butter_whiteboard:server:rename', data.id, data.name)
end)

RegisterNUICallback('adminClear', function(data, cb)
    action(cb, 'butter_whiteboard:server:adminClear', data.id)
end)

RegisterNUICallback('adminRemove', function(data, cb)
    action(cb, 'butter_whiteboard:server:adminRemove', data.id)
end)

RegisterNUICallback('adminWaypoint', function(data, cb)
    cb(1)
    local board = Boards.list[data.id]
    if not board then return end
    SetNewWaypoint(board.coords.x, board.coords.y)
    Notify('inform', 'waypoint_set')
end)

RegisterNUICallback('adminTeleport', function(data, cb)
    cb(1)
    local board = Boards.list[data.id]
    if not board or not (Perms.summary and Perms.summary.admin) then return end
    Admin.Close()
    local pos, heading = standSpot(board)
    CreateThread(function()
        local ped = cache.ped
        RequestCollisionAtCoord(pos.x, pos.y, pos.z)
        SetEntityCoords(ped, pos.x, pos.y, pos.z, false, false, false, false)
        local timeout = GetGameTimer() + 2000
        while not HasCollisionLoadedAroundEntity(ped) and GetGameTimer() < timeout do Wait(0) end
        local found, ground = GetGroundZFor_3dCoord(pos.x, pos.y, pos.z + 1.0, false)
        if found then SetEntityCoords(ped, pos.x, pos.y, ground, false, false, false, false) end
        SetEntityHeading(ped, heading)
    end)
end)

RegisterNUICallback('adminPlace', function(_, cb)
    cb(1)
    Admin.Close()
    TriggerServerEvent('butter_whiteboard:server:adminPlace')
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == cache.resource and Admin.open then SetNuiFocus(false, false) end
end)
