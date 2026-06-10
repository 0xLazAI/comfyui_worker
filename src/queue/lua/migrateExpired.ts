export const migrateExpiredLua = `-- queue_script:migrate_expired
local source = KEYS[1]
local ready = KEYS[2]
local notify = KEYS[3]
local now = tonumber(ARGV[1])
local batch_size = tonumber(ARGV[2])

local payloads = redis.call('ZRANGEBYSCORE', source, '-inf', now, 'LIMIT', 0, batch_size)
if #payloads == 0 then
  return 0
end

redis.call('ZREM', source, unpack(payloads))
redis.call('RPUSH', ready, unpack(payloads))
for i = 1, #payloads do
  redis.call('RPUSH', notify, '1')
end

return #payloads
`;
