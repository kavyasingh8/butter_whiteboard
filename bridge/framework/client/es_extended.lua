if not UseBridge('framework', 'es_extended') then return end

RegisterNetEvent('esx:playerLoaded', function() Perms.Refresh() end)
RegisterNetEvent('esx:setJob', function() Perms.Refresh() end)
