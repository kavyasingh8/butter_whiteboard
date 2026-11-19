if not UseBridge('framework', 'qbx_core') then return end

---@param source number
local function getPlayer(source)
    return exports.qbx_core:GetPlayer(source)
end

---@param source number
---@return string?
function GetCitizenId(source)
    local player = getPlayer(source)
    return player and player.PlayerData.citizenid
end

---@param source number
---@return string
function GetCharacterName(source)
    local player = getPlayer(source)
    if not player then return GetPlayerName(source) end
    local charinfo = player.PlayerData.charinfo
    return ('%s %s'):format(charinfo.firstname, charinfo.lastname)
end

---@param source number
---@return { name: string, grade: number, onduty: boolean }?
function GetJob(source)
    local player = getPlayer(source)
    local job = player and player.PlayerData.job
    if not job then return nil end
    return { name = job.name, grade = job.grade and job.grade.level or 0, onduty = job.onduty }
end

---@param source number
---@return boolean
function IsAdmin(source)
    if Config.Admin.ace and IsPlayerAceAllowed(source, Config.Admin.ace) then return true end
    for _, group in ipairs(Config.Admin.groups) do
        if exports.qbx_core:HasPermission(source, group) then return true end
    end
    return false
end

---@param item string
---@param cb fun(source: number)
function CreateUsableItem(item, cb)
    exports.qbx_core:CreateUseableItem(item, function(source) cb(source) end)
end
