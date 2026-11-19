-- Admin panel: every board on the server, with a preview, teleport, clear,
-- delete and placing new boards. Every callback checks IsAdmin itself.

local PREVIEW_LIMIT = 20 -- previews per admin every 10 seconds
local previewCounts = {}

local function listBoards()
    local out = {}
    for _, b in pairs(Boards.list) do
        out[#out + 1] = {
            id = b.id,
            name = b.name,
            owner = b.owner,
            ownerName = b.ownerName,
            model = b.model,
            x = b.coords.x, y = b.coords.y, z = b.coords.z,
            heading = b.heading,
            width = b.width,
            bucket = b.bucket,
            ops = #b.ops,
            points = b.points,
            updated = b.updated,
        }
    end
    table.sort(out, function(a, b) return a.id < b.id end)
    return out
end

lib.addCommand(Config.AdminCommand, { help = locale('admin_command_help') }, function(src)
    if not IsAdmin(src) then return Notify(src, 'error', 'no_permission') end
    TriggerClientEvent('butter_whiteboard:client:openAdmin', src)
end)

lib.callback.register('butter_whiteboard:server:adminList', function(src)
    if not IsAdmin(src) then return nil end
    return { boards = listBoards(), now = os.time(), limits = { ops = Config.Limits.maxOps, points = Config.Limits.maxPoints } }
end)

-- Contents can be large, so they go back on a latent event instead of the callback.
RegisterNetEvent('butter_whiteboard:server:adminPreview', function(id)
    local src = source
    if not IsAdmin(src) then return end
    previewCounts[src] = (previewCounts[src] or 0) + 1
    id = tonumber(id)
    -- Over the limit the panel is told to ask again later, instead of waiting forever.
    if previewCounts[src] > PREVIEW_LIMIT then
        return TriggerClientEvent('butter_whiteboard:client:adminPreview', src, id, false, true)
    end
    TriggerLatentClientEvent('butter_whiteboard:client:adminPreview', src, ServerConfig.TransferRate, id, id and Drawing.ClientContent(id) or false)
end)

lib.callback.register('butter_whiteboard:server:adminClear', function(src, id)
    if not IsAdmin(src) then return false, 'no_permission' end
    local board = Boards.list[tonumber(id) or -1]
    if not board then return false, 'missing_board' end
    Drawing.Clear(board.id, src)
    Log('Whiteboard cleared', ('%s (admin) cleared board #%d'):format(GetCharacterName(src), board.id))
    return true, 'board_cleared'
end)

lib.callback.register('butter_whiteboard:server:adminRemove', function(src, id)
    if not IsAdmin(src) then return false, 'no_permission' end
    local board = Boards.list[tonumber(id) or -1]
    if not board then return false, 'missing_board' end
    if not Boards.Delete(board.id) then return false, 'save_failed' end
    Log('Whiteboard removed', ('%s (admin) removed board #%d placed by %s'):format(GetCharacterName(src), board.id, board.ownerName))
    return true, 'board_removed'
end)

RegisterNetEvent('butter_whiteboard:server:adminPlace', function()
    local src = source
    if not IsAdmin(src) then return end
    Boards.StartPlacement(src, 'admin')
end)

CreateThread(function()
    while true do
        Wait(10000)
        previewCounts = {}
    end
end)

AddEventHandler('playerDropped', function()
    previewCounts[source] = nil
end)
