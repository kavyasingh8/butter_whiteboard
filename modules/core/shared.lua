local RESOURCE = cache.resource
local IS_SERVER = IsDuplicityVersion()

--- True only for a resource started under exactly this name. GetResourceState
--- also reports names a resource `provide`s (qbx_core providing qb-core),
--- which would load the wrong bridge.
---@param name string
---@return boolean
function IsResourceStarted(name)
    for i = 0, GetNumResources() - 1 do
        if GetResourceByFindIndex(i) == name then
            return GetResourceState(name) == 'started'
        end
    end
    return false
end

local loadedBridges = {} ---@type table<string, string>

--- Bridge guard: true when `resource` is started, and records it for the
--- startup log. A later bridge in the same category replaces the earlier
--- one's functions, so running two of them is warned about.
---@param category string
---@param resource string
---@return boolean
function UseBridge(category, resource)
    if not IsResourceStarted(resource) then return false end

    local previous = loadedBridges[category]
    if previous then
        print(('^3[%s]^7 %s and %s are both running for %s, %s is used'):format(RESOURCE, previous, resource, category, resource))
    end
    loadedBridges[category] = resource
    return true
end

-- Runs once every script has loaded. Client bridges are only listed in F8 with Config.Debug.
CreateThread(function()
    if IS_SERVER or Config.Debug then
        local categories = {}
        for category in pairs(loadedBridges) do categories[#categories + 1] = category end
        table.sort(categories)
        for _, category in ipairs(categories) do
            print(('^5[%s]^7 %-10s bridge: ^5%s^7'):format(RESOURCE, category, loadedBridges[category]))
        end
    end

    if not IS_SERVER then return end
    if not GetCitizenId then
        print(('^1[%s]^7 No supported framework is running. Start qbx_core, qb-core or es_extended first.'):format(RESOURCE))
    end
    if RemoveItem then return end
    local items = {}
    for _, m in ipairs(Config.Models) do
        if m.item then items[#items + 1] = m.item end
    end
    if #items > 0 then
        print(('^1[%s]^7 No supported inventory is running, the %s item(s) will not work.'):format(RESOURCE, table.concat(items, ', ')))
    end
end)
