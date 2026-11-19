Perms = {}

local ACTIONS = { 'draw', 'clear', 'move', 'remove', 'rename' }

local function hasJob(src, jobs)
    if not jobs then return false end
    local job = GetJob(src)
    if not job then return false end
    local minGrade = jobs[job.name]
    if not minGrade or job.grade < minGrade then return false end
    return job.onduty or not Config.Permissions.onDuty
end

--- Whether `src` can do `action` on any board, regardless of ownership.
local function canAny(src, action, admin)
    if admin then return true end
    local rule = Config.Permissions[action]
    if not rule then return false end
    return rule.everyone == true or hasJob(src, rule.jobs)
end

---@param board table? the board being acted on
function Perms.Can(src, action, board)
    local admin = IsAdmin(src)
    if canAny(src, action, admin) then return true end
    local rule = Config.Permissions[action]
    return board ~= nil and rule and rule.owner == true and board.owner == GetCitizenId(src) or false
end

--- What the client may show in its target menu. Ownership is resolved per
--- board on the client from the ids it owns, the server still checks every action.
function Perms.Summary(src)
    local admin = IsAdmin(src)
    local out = { admin = admin }
    for _, action in ipairs(ACTIONS) do
        local rule = Config.Permissions[action] or {}
        out[action] = { any = canAny(src, action, admin), own = rule.owner == true }
    end
    return out
end
