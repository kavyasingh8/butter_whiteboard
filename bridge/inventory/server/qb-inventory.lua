-- Also covers ps-inventory and lj-inventory, which hook the same player functions.
local INVENTORY
for _, name in ipairs({ 'qb-inventory', 'ps-inventory', 'lj-inventory' }) do
    if UseBridge('inventory', name) then
        INVENTORY = name
        break
    end
end
if not INVENTORY then return end

local QBCore = exports['qb-core']:GetCoreObject()

---@param source number
---@param item string
---@param count integer?
---@return boolean
function AddItem(source, item, count)
    local player = QBCore.Functions.GetPlayer(source)
    return player ~= nil and player.Functions.AddItem(item, count or 1) == true
end

---@param source number
---@param item string
---@param count integer?
---@return boolean
function RemoveItem(source, item, count)
    local player = QBCore.Functions.GetPlayer(source)
    return player ~= nil and player.Functions.RemoveItem(item, count or 1) == true
end
