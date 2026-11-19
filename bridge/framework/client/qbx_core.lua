if not UseBridge('framework', 'qbx_core') then return end

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function() Perms.Refresh() end)
RegisterNetEvent('QBCore:Client:OnJobUpdate', function() Perms.Refresh() end)
RegisterNetEvent('QBCore:Client:SetDuty', function() Perms.Refresh() end)
