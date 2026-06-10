export const laterLua = `-- queue_script:later
local delayed = KEYS[1]
local available_at = tonumber(ARGV[1])
local payload = ARGV[2]

redis.call('ZADD', delayed, available_at, payload)

return 1
`;
