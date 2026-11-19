if not UseBridge('framework', 'es_extended') then return end

local ESX = exports['es_extended']:getSharedObject()

---@param source number
---@return string?
function GetCitizenId(source)
    local player = ESX.GetPlayerFromId(source)
    return player and player.identifier
end

---@param source number
---@return string
function GetCharacterName(source)
    local player = ESX.GetPlayerFromId(source)
    return player and player.getName() or GetPlayerName(source)
end

---@param source number
---@return { name: string, grade: number, onduty: boolean }?
function GetJob(source)
    local player = ESX.GetPlayerFromId(source)
    local job = player and player.getJob()
    if not job then return nil end
    -- Duty is optional in ESX, a job without it counts as on duty.
    return { name = job.name, grade = job.grade or 0, onduty = job.onDuty ~= false }
end

---@param source number
---@return boolean
function IsAdmin(source)
    if Config.Admin.ace and IsPlayerAceAllowed(source, Config.Admin.ace) then return true end
    local player = ESX.GetPlayerFromId(source)
    if not player then return false end
    local group = player.getGroup()
    for _, admin in ipairs(Config.Admin.groups) do
        if group == admin then return true end
    end
    return false
end

---@param item string
---@param cb fun(source: number)
function CreateUsableItem(item, cb)
    ESX.RegisterUsableItem(item, function(source) cb(source) end)
end
