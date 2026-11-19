fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'ButterChilly'
description 'butter_whiteboard - Multiplayer whiteboards with live drawing, shapes, images and an admin panel'
version '2.0.0'
repository 'https://github.com/kavyasingh8/butter_whiteboard'

ui_page 'web/index.html'

shared_scripts {
    '@ox_lib/init.lua',
    'config/shared.lua',
    'modules/core/shared.lua',
}

client_scripts {
    'modules/main/client.lua',
    'bridge/**/client/*.lua',
    'modules/render/client.lua',
    'modules/boards/client.lua',
    'modules/placement/client.lua',
    'modules/editor/client.lua',
    'modules/admin/client.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'config/server.lua',
    'bridge/**/server/*.lua',
    'modules/permissions/server.lua',
    'modules/database/server.lua',
    'modules/drawing/server.lua',
    'modules/boards/server.lua',
    'modules/admin/server.lua',
    'modules/version/server.lua',
}

files {
    'web/index.html',
    'web/dui.html',
    'web/assets/**/*',
    'locales/*.json',
}

dependencies {
    'oxmysql',
    'ox_lib',
    'ox_target',
    'butter_whiteboard_prop',
}
