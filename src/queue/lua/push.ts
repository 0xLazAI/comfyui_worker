export const pushLua = `-- queue_script:push
local ready = KEYS[1]
local notify = KEYS[2]
local payload = ARGV[1]

redis.call('RPUSH', ready, payload)
redis.call('RPUSH', notify, '1')

return 1
`;
