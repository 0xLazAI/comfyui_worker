export const clearLua = `-- queue_script:clear
local ready = KEYS[1]
local delayed = KEYS[2]
local reserved = KEYS[3]
local notify = KEYS[4]

return redis.call('DEL', ready, delayed, reserved, notify)
`;
