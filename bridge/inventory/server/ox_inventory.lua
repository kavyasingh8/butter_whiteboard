if not UseBridge('inventory', 'ox_inventory') then return end

---@param source number
---@param item string
---@param count integer?
---@return boolean
function AddItem(source, item, count)
    return exports.ox_inventory:AddItem(source, item, count or 1) == true
end

---@param source number
---@param item string
---@param count integer?
---@return boolean
function RemoveItem(source, item, count)
    return exports.ox_inventory:RemoveItem(source, item, count or 1) == true
end
