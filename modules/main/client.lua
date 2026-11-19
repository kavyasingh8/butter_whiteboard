Perms = { summary = nil, owned = {} }

local surfaces = {}
local modelConfigs = {}
for _, m in ipairs(Config.Models) do modelConfigs[m.model] = m end

function Debug(fmt, ...)
    if not Config.Debug then return end
    print(('^5[butter_whiteboard]^7 ' .. fmt):format(...))
end

-- Far from every board the proximity loops sleep longer: they can't miss a
-- board even at jet speed (about 100 m/s), so idle cost stays at nothing.
local IDLE_SPEED = 100.0
local IDLE_MAX = 5000

--- How long a proximity loop may sleep. `gap` is how many metres the closest
--- board is outside the loop's range, `base` its normal interval.
function IdleSleep(gap, base)
    return math.floor(math.max(base, math.min(IDLE_MAX, gap / IDLE_SPEED * 1000)))
end

--- Loads a model without throwing. lib.requestModel errors on a missing model
--- or a slow load, which would kill the loop that called it for good.
---@return number? hash nil when the model is missing or did not load in time
function LoadModel(model, timeout)
    local hash = type(model) == 'number' and model or joaat(model)
    if not IsModelInCdimage(hash) then return nil end
    local ok = pcall(lib.requestModel, hash, timeout or 10000)
    return ok and HasModelLoaded(hash) and hash or nil
end

function Notify(type, key, ...)
    lib.notify({ type = type, description = locale(key, ...) })
end

--- The `ui` section of the active locale, sent to the NUI so it is translated too.
---@return table<string, string>
function UiLocale()
    local out = {}
    for key, value in pairs(lib.getLocales()) do
        if key:sub(1, 3) == 'ui.' then out[key:sub(4)] = value end
    end
    return out
end

--- Raycast from the camera that answers in the same frame, unlike lib.raycast,
--- so a loop using it can still draw and read input every frame.
---@return boolean hit, vector3 coords, vector3 normal
function AimFromCamera(flags, distance)
    local origin = GetFinalRenderedCamCoord()
    local rot = GetFinalRenderedCamRot(2)
    local rx, rz = math.rad(rot.x), math.rad(rot.z)
    local dir = vec3(-math.sin(rz) * math.abs(math.cos(rx)), math.cos(rz) * math.abs(math.cos(rx)), math.sin(rx))
    local dest = origin + dir * distance
    local handle = StartExpensiveSynchronousShapeTestLosProbe(origin.x, origin.y, origin.z, dest.x, dest.y, dest.z, flags, cache.ped, 4)
    local _, hit, coords, normal = GetShapeTestResult(handle)
    return hit == true or hit == 1, coords, normal
end

function ModelConfig(model)
    return modelConfigs[model]
end

--- A face of the surface in local space. `normal` points out of the face,
--- `left` is the viewer's left when looking at it, and `angle` is the heading
--- offset that turns the face towards where the prop's +Y would point.
---@param axis 'x'|'y'
---@param front 1|-1
local function makeFace(axis, front, offset)
    if axis == 'x' then
        return { axis = axis, front = front, offset = offset, normal = vec3(front, 0, 0), left = vec3(0, -front, 0), angle = front * 90.0 }
    end
    return { axis = axis, front = front, offset = offset, normal = vec3(0, front, 0), left = vec3(front, 0, 0), angle = front == 1 and 0.0 or 180.0 }
end

local CANVAS_ASPECT = Config.Canvas.width / Config.Canvas.height

--- Shrinks one side so the drawing is not stretched on a surface that is not 16:9.
local function fitToCanvas(surface)
    if surface.width / surface.height > CANVAS_ASPECT then
        surface.width = surface.height * CANVAS_ASPECT
    else
        surface.height = surface.width / CANVAS_ASPECT
    end
    return surface
end

--- Drawing surface of a model in its local space: { width, height, faces }.
--- Fitted to the model's bounding box when the config leaves it out: the face
--- lies on the thinner horizontal axis, on the side `front` picks.
function GetSurface(model)
    if surfaces[model] then return surfaces[model] end
    local cfg = modelConfigs[model]
    if not cfg then return nil end

    local surface
    if cfg.surface then
        local front = cfg.front == -1 and -1 or 1
        surface = {
            width = cfg.surface.width,
            height = cfg.surface.height,
            faces = { makeFace(cfg.axis == 'x' and 'x' or 'y', front, cfg.surface.offset) },
        }
    else
        local min, max = GetModelDimensions(joaat(model))
        local pad = cfg.padding or 0.05
        local size = max - min
        local axis = cfg.axis or (size.x < size.y and 'x' or 'y')
        local c = (min + max) / 2
        local plus, minus, width
        if axis == 'x' then
            plus = makeFace('x', 1, vec3(max.x + 0.01, c.y, c.z))
            minus = makeFace('x', -1, vec3(min.x - 0.01, c.y, c.z))
            width = size.y
        else
            plus = makeFace('y', 1, vec3(c.x, max.y + 0.01, c.z))
            minus = makeFace('y', -1, vec3(c.x, min.y - 0.01, c.z))
            width = size.x
        end
        surface = {
            width = math.max(0.1, width - pad * 2),
            height = math.max(0.1, size.z - pad * 2),
            faces = { cfg.front == -1 and minus or plus },
        }
    end
    surfaces[model] = cfg.stretch and surface or fitToCanvas(surface)
    return surface
end

--- Height of a free panel: it keeps the canvas shape so drawings aren't stretched.
function PanelHeight(width)
    return width * Config.Canvas.height / Config.Canvas.width
end

--- Drawing surface of a free panel, centred on the board's coords.
function GetPanelSurface(width)
    local cfg = modelConfigs.panel.panel
    -- Faces sit 2mm either side of the centre so the two sides don't fight.
    local faces = { makeFace('y', 1, vec3(0.0, 0.002, 0.0)) }
    if cfg.doubleSided then faces[2] = makeFace('y', -1, vec3(0.0, -0.002, 0.0)) end
    return { width = width, height = PanelHeight(width), faces = faces }
end

--- Drawing surface of any board, prop or free panel.
function GetBoardSurface(board)
    if board.panel then return GetPanelSurface(board.width) end
    return GetSurface(board.model)
end

local function buildFaces(s, world)
    local out = {}
    for i, face in ipairs(s.faces) do
        local o, left, up = face.offset, face.left * (s.width / 2), vec3(0, 0, s.height / 2)
        local center = world(o)
        out[i] = {
            center = center,
            normal = world(o + face.normal) - center,
            radius = math.sqrt((s.width / 2) ^ 2 + (s.height / 2) ^ 2),
            corners = { world(o + left + up), world(o - left + up), world(o + left - up), world(o - left - up) },
        }
    end
    return out
end

--- World space faces of an entity's drawing surface. Each has a centre, an
--- outward normal and corners (top left, top right, bottom left, bottom right)
--- as seen from in front of it.
function GetSurfaceFaces(entity, model)
    return buildFaces(GetSurface(model), function(v) return GetOffsetFromEntityInWorldCoords(entity, v.x, v.y, v.z) end)
end

--- Same as GetSurfaceFaces for a free panel, which has no entity.
function GetPanelFaces(coords, heading, width)
    local r = math.rad(heading)
    local c, s = math.cos(r), math.sin(r)
    return buildFaces(GetPanelSurface(width), function(v)
        return coords + vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z)
    end)
end

---@param action 'draw'|'clear'|'move'|'remove'|'rename'
function Perms.Allowed(action, boardId)
    local rule = Perms.summary and Perms.summary[action]
    if not rule then return false end
    return rule.any or (rule.own and boardId ~= nil and Perms.owned[boardId] == true)
end

local function applyPerms(data)
    if not data then return end
    Perms.summary = data.perms
    Perms.owned = {}
    for _, id in ipairs(data.owned) do Perms.owned[id] = true end
    Editor.PermsChanged()
end

function Perms.Refresh()
    applyPerms(lib.callback.await('butter_whiteboard:server:perms', false))
end

function Perms.Apply(data)
    applyPerms(data)
end

RegisterNetEvent('butter_whiteboard:client:owned', function(id)
    Perms.owned[id] = true
    Editor.PermsChanged()
end)
