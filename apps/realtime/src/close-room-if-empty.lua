-- KEYS[1] = peersKey, KEYS[2] = roomKey. Atomic so a concurrent addPeer
-- can't land between the emptiness check and the delete (issue #24).
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
