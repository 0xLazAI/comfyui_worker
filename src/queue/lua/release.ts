export const releaseLua = `-- queue_script:release
local reserved = KEYS[1]
local delayed = KEYS[2]
local reserved_payload = ARGV[1]
local available_at = tonumber(ARGV[2])
local updated_payload = ARGV[3]

redis.call('ZREM', reserved, reserved_payload)
redis.call('ZADD', delayed, available_at, updated_payload)

return 1
`;
