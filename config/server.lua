ServerConfig = {}

-- Dirty boards are written to SQL this often (seconds). Everything is also
-- flushed when the resource stops.
ServerConfig.SaveInterval = 30

-- Bytes per second for latent events carrying board contents.
ServerConfig.TransferRate = 500000

-- Discord webhook for place/move/rename/remove/clear/restore logs. Leave empty to disable.
ServerConfig.Webhook = ''

-- Check GitHub on start and print in the server console when an update is released.
ServerConfig.VersionCheck = true
