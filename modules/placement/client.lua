Placement = { active = false }

local RAY_FLAGS = 1 | 16 -- world and objects
local DISABLED_CONTROLS = { 14, 15, 16, 17, 24, 25, 36, 37, 44, 140, 141, 142, 172, 173, 199, 200 }
local WALL_GAP = 0.02 -- metres a free panel sits off the wall it hangs on

--- Asks for the model (when there is a choice) and an optional name.
---@param allowed string[]? models the used item places, nil for any
---@return string? model, string? name
local function chooseModel(allowed)
    local allowedSet
    if allowed then
        allowedSet = {}
        for _, model in ipairs(allowed) do allowedSet[model] = true end
    end

    local options = {}
    for _, m in ipairs(Config.Models) do
        if (not allowedSet or allowedSet[m.model]) and (m.panel or IsModelInCdimage(joaat(m.model))) then
            options[#options + 1] = { value = m.model, label = m.label }
        end
    end
    if #options == 0 then
        Notify('error', 'no_models')
        return nil
    end

    local fields = { { type = 'input', label = locale('name'), placeholder = locale('name_placeholder'), max = Config.NameLength } }
    if #options > 1 then
        table.insert(fields, 1, { type = 'select', label = locale('model'), options = options, default = options[1].value, required = true })
    end
    local input = lib.inputDialog(locale('choose_model'), fields)
    if not input then return nil end
    if #options == 1 then return options[1].value, input[1] end
    return input[1], input[2]
end

local function showHelp()
    lib.showTextUI(locale('placement_help'), { position = 'left-center' })
end

local function cancelPressed()
    return IsDisabledControlJustPressed(0, 177) or IsDisabledControlJustPressed(0, 25) or IsDisabledControlJustPressed(0, 200)
end

local function drawPanelPreview(faces, valid)
    local alpha = valid and 90 or 35
    local f = faces[1].corners
    local tl, tr, bl, br = f[1], f[2], f[3], f[4]
    DrawPoly(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, 246, 247, 244, alpha)
    DrawPoly(tr.x, tr.y, tr.z, br.x, br.y, br.z, bl.x, bl.y, bl.z, 246, 247, 244, alpha)
    DrawPoly(bl.x, bl.y, bl.z, tr.x, tr.y, tr.z, tl.x, tl.y, tl.z, 246, 247, 244, alpha)
    DrawPoly(bl.x, bl.y, bl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, 246, 247, 244, alpha)
    DrawLine(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, 255, 255, 255, 255)
    DrawLine(tr.x, tr.y, tr.z, br.x, br.y, br.z, 255, 255, 255, 255)
    DrawLine(br.x, br.y, br.z, bl.x, bl.y, bl.z, 255, 255, 255, 255)
    DrawLine(bl.x, bl.y, bl.z, tl.x, tl.y, tl.z, 255, 255, 255, 255)
end

--- Lets the player position and size a free panel, which has no prop. Returns
--- its centre, heading and width, or nil when cancelled.
---@param start { coords: vector3, heading: number, width: number }?
local function runPanel(start)
    local cfg = ModelConfig('panel').panel
    local width = start and start.width or cfg.width
    local heading = start and start.heading or (GetEntityHeading(cache.ped) + 180.0) % 360.0
    local lift = 0.0
    local center, placeHeading
    local result
    Placement.active = true

    local function help()
        lib.showTextUI(locale('placement_help_panel', width, PanelHeight(width)), { position = 'left-center' })
    end
    help()

    -- Runs every frame: the preview only lasts the frame it is drawn in.
    while true do
        for _, control in ipairs(DISABLED_CONTROLS) do DisableControlAction(0, control, true) end
        local height = PanelHeight(width)
        local hit, coords, normal = AimFromCamera(RAY_FLAGS, Config.Placement.maxDistance + 3.0)
        local valid = hit and #(GetEntityCoords(cache.ped) - coords) <= Config.Placement.maxDistance
        if hit and math.abs(normal.z) < 0.5 then
            -- Aimed at a wall: hang flat on it, centred on the aim point.
            placeHeading = math.deg(math.atan(-normal.x, normal.y)) % 360.0
            center = coords + vec3(normal.x, normal.y, 0.0) * WALL_GAP + vec3(0.0, 0.0, lift)
        elseif hit then
            -- Aimed at the ground: stand on it, facing the way the scroll wheel turns it.
            placeHeading = heading
            center = coords + vec3(0.0, 0.0, height / 2 + lift)
        end

        local notch = (IsDisabledControlJustPressed(0, 15) and 1) or (IsDisabledControlJustPressed(0, 14) and -1) or 0
        if notch ~= 0 and IsDisabledControlPressed(0, 36) then
            width = math.min(cfg.maxWidth, math.max(cfg.minWidth, width * (1 + 0.05 * notch)))
            help()
        elseif notch ~= 0 then
            heading = (heading + notch * Config.Placement.rotateStep) % 360.0
        end
        if IsDisabledControlPressed(0, 172) then lift = math.min(Config.Placement.maxHeight, lift + Config.Placement.heightStep) end
        if IsDisabledControlPressed(0, 173) then lift = math.max(0.0, lift - Config.Placement.heightStep) end

        if center then
            drawPanelPreview(GetPanelFaces(center, placeHeading, width), valid)
            if IsControlJustPressed(0, 38) and valid then
                result = { coords = { x = center.x, y = center.y, z = center.z }, heading = placeHeading, width = width }
                break
            end
        end
        if cancelPressed() then break end
        Wait(0)
    end

    lib.hideTextUI()
    Placement.active = false
    return result
end

--- Lets the player position a ghost of `model`. Returns coords and heading,
--- or nil when cancelled.
---@param start { coords: vector3, heading: number }?
local function runGhost(model, start)
    local hash = LoadModel(model)
    if not hash then
        Notify('error', 'failed')
        return nil
    end
    local face = GetSurface(model).faces[1]
    local min, max = GetModelDimensions(hash)
    -- How far the prop's back sits behind its origin, so it can rest flat on a wall.
    local n = face.normal
    local backDepth = math.max(-(min.x * n.x + min.y * n.y), -(max.x * n.x + max.y * n.y)) + 0.01
    local spawnAt = start and start.coords or GetEntityCoords(cache.ped)
    local ghost = CreateObjectNoOffset(hash, spawnAt.x, spawnAt.y, spawnAt.z, false, false, false)
    SetModelAsNoLongerNeeded(hash)
    SetEntityAlpha(ghost, 170, false)
    SetEntityCollision(ghost, false, false)
    FreezeEntityPosition(ghost, true)

    -- New boards face the player.
    local heading = start and start.heading or (GetEntityHeading(cache.ped) + 180.0 + face.angle) % 360.0
    local lift = 0.0
    local result
    Placement.active = true
    showHelp()

    while true do
        for _, control in ipairs(DISABLED_CONTROLS) do DisableControlAction(0, control, true) end
        local hit, coords, normal = AimFromCamera(RAY_FLAGS, Config.Placement.maxDistance + 3.0)
        local valid = hit and #(GetEntityCoords(cache.ped) - coords) <= Config.Placement.maxDistance
        -- Aiming at a wall hangs the board flat on it, centred on the aim point.
        local onWall = hit and math.abs(normal.z) < 0.5
        local placeHeading = heading
        if onWall then
            placeHeading = (math.deg(math.atan(-normal.x, normal.y)) + face.angle) % 360.0
            local pos = coords + vec3(normal.x, normal.y, 0.0) * backDepth
            SetEntityCoordsNoOffset(ghost, pos.x, pos.y, pos.z + lift, false, false, false)
        elseif hit then
            -- The origin is not always at the bottom, so lift the prop onto the ground.
            SetEntityCoordsNoOffset(ghost, coords.x, coords.y, coords.z - min.z + lift, false, false, false)
        end
        SetEntityHeading(ghost, placeHeading)
        SetEntityAlpha(ghost, valid and 170 or 70, false)

        if IsDisabledControlJustPressed(0, 15) then heading = (heading + Config.Placement.rotateStep) % 360.0 end
        if IsDisabledControlJustPressed(0, 14) then heading = (heading - Config.Placement.rotateStep) % 360.0 end
        if IsDisabledControlPressed(0, 172) then lift = math.min(Config.Placement.maxHeight, lift + Config.Placement.heightStep) end
        if IsDisabledControlPressed(0, 173) then lift = math.max(0.0, lift - Config.Placement.heightStep) end

        if IsControlJustPressed(0, 38) and valid then
            local pos = GetEntityCoords(ghost)
            result = { coords = { x = pos.x, y = pos.y, z = pos.z }, heading = placeHeading }
            break
        end
        if cancelPressed() then break end
        Wait(0)
    end

    lib.hideTextUI()
    DeleteEntity(ghost)
    Placement.active = false
    return result
end

---@param allowed string[]? models the used item places, nil for any
local function place(allowed)
    -- Busy moving a board: let the server forget this placement, or it would stay pending.
    if Placement.active then return TriggerServerEvent('butter_whiteboard:server:cancelPlacement') end
    local model, name = chooseModel(allowed)
    if not model then return TriggerServerEvent('butter_whiteboard:server:cancelPlacement') end

    local spot
    if ModelConfig(model).panel then spot = runPanel() else spot = runGhost(model) end
    if not spot then
        TriggerServerEvent('butter_whiteboard:server:cancelPlacement')
        return Notify('inform', 'placement_cancelled')
    end

    local ok, reason = lib.callback.await('butter_whiteboard:server:place', false, model, spot.coords, spot.heading, spot.width, name)
    if not ok then
        TriggerServerEvent('butter_whiteboard:server:cancelPlacement')
        return Notify('error', reason or 'failed')
    end
    Notify('success', 'board_placed')
end

function Placement.Move(id)
    local board = Boards.list[id]
    if Placement.active or not board then return end

    -- The server checks we are at the board now, the player may walk off with it after.
    Placement.active = true
    local started, startReason = lib.callback.await('butter_whiteboard:server:startMove', false, id)
    Placement.active = false
    if not started then return Notify('error', startReason or 'failed') end
    if not Boards.list[id] then return end

    Boards.SetHidden(id, true)
    local start = { coords = board.coords, heading = board.heading, width = board.width }
    local spot
    if board.panel then spot = runPanel(start) else spot = runGhost(board.model, start) end
    if spot then
        local ok, reason = lib.callback.await('butter_whiteboard:server:move', false, id, spot.coords, spot.heading, spot.width)
        Notify(ok and 'success' or 'error', ok and 'board_moved' or (reason or 'failed'))
    end
    Boards.SetHidden(id, false)
end

RegisterNetEvent('butter_whiteboard:client:startPlacement', place)
