DB = {}

local function ensureColumn(name, definition)
    local exists = MySQL.scalar.await([[
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'butter_whiteboards' AND COLUMN_NAME = ?
    ]], { name })
    if exists == 0 then
        MySQL.query.await(('ALTER TABLE butter_whiteboards ADD COLUMN `%s` %s'):format(name, definition))
    end
end

function DB.Init()
    MySQL.query.await(LoadResourceFile(cache.resource, 'sql/butter_whiteboard.sql'))

    -- Tables made by older versions miss these. Props leave width at 0, boards
    -- placed before routing buckets were tracked belong to the default bucket.
    ensureColumn('width', 'FLOAT NOT NULL DEFAULT 0 AFTER `heading`')
    ensureColumn('from_item', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `width`')
    ensureColumn('name', 'VARCHAR(128) NULL DEFAULT NULL AFTER `owner_name`')
    ensureColumn('bucket', 'INT NOT NULL DEFAULT 0 AFTER `from_item`')
    ensureColumn('item', 'VARCHAR(64) NULL DEFAULT NULL AFTER `from_item`')
end

function DB.LoadAll()
    return MySQL.query.await('SELECT id, owner, owner_name, name, model, x, y, z, heading, width, from_item, item, bucket, content, UNIX_TIMESTAMP(updated_at) AS updated FROM butter_whiteboards') or {}
end

---@return number? id
function DB.Insert(b)
    return MySQL.insert.await([[
        INSERT INTO butter_whiteboards (owner, owner_name, name, model, x, y, z, heading, width, from_item, item, bucket, content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ]], { b.owner, b.ownerName, b.name, b.model, b.coords.x, b.coords.y, b.coords.z, b.heading, b.width or 0, b.item and 1 or 0, b.item, b.bucket or 0, '[]' })
end

---@param name string? nil clears it
function DB.SetName(id, name)
    return MySQL.update.await('UPDATE butter_whiteboards SET name = ? WHERE id = ?', { name, id })
end

function DB.SetPosition(id, coords, heading, width)
    return MySQL.update.await('UPDATE butter_whiteboards SET x = ?, y = ?, z = ?, heading = ?, width = ? WHERE id = ?',
        { coords.x, coords.y, coords.z, heading, width or 0, id })
end

function DB.Delete(id)
    return MySQL.update.await('DELETE FROM butter_whiteboards WHERE id = ?', { id })
end

--- Writes several boards' contents in one transaction.
---@param rows { id: number, content: string }[]
---@param onDone fun(ok: boolean)? queue the transaction and call this when it finishes, instead of waiting
function DB.SaveContents(rows, onDone)
    if #rows == 0 then return true end
    local queries = {}
    for i, row in ipairs(rows) do
        queries[i] = { query = 'UPDATE butter_whiteboards SET content = ? WHERE id = ?', values = { row.content, row.id } }
    end
    if onDone then return MySQL.transaction(queries, onDone) end
    return MySQL.transaction.await(queries)
end
