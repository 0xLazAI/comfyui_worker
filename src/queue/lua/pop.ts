export const popLua = `-- queue_script:pop
local ready = KEYS[1]
local reserved = KEYS[2]
local notify = KEYS[3]
local now = tonumber(ARGV[1])
local retry_after = tonumber(ARGV[2])

local payload = redis.call('LPOP', ready)
if not payload then
  return false
end

local updated_payload = payload
local ok, decoded = pcall(cjson.decode, payload)
if ok and decoded then
  decoded['attempts'] = tonumber(decoded['attempts'] or 0) + 1
  updated_payload = cjson.encode(decoded)
end

redis.call('ZADD', reserved, now + retry_after, updated_payload)
redis.call('LPOP', notify)

return updated_payload
`;
