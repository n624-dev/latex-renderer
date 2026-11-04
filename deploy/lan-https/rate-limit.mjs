// Fixed windows bound both CPU work and the number of remembered sources.
// Keys must be derived from the real socket peer by the listener, never from a
// client-controlled forwarding header. This state is deliberately short-lived.
export function createLanHttpsRateLimit({
  maxKeys = 1024,
  requestsPerKey = 64,
  requestsTotal = 256,
  windowMs = 1000,
  now = Date.now,
} = {}) {
  for (const value of [maxKeys, requestsPerKey, requestsTotal, windowMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000)
      throw new Error("Rate limits require bounded positive integers");
  }
  if (maxKeys > 65_536 || requestsPerKey > requestsTotal)
    throw new Error("Invalid bounded source rate limit");
  const sources = new Map();
  let started = null,
    total = 0;
  return Object.freeze({
    allow(key) {
      const time = now();
      if (
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 128 ||
        !Number.isSafeInteger(time) ||
        time < 0 ||
        (started !== null && time < started)
      )
        return false;
      if (started === null || time - started >= windowMs) {
        sources.clear();
        total = 0;
        started = time;
      }
      if (total >= requestsTotal) return false;
      const count = sources.get(key) ?? 0;
      if (
        count >= requestsPerKey ||
        (!sources.has(key) && sources.size >= maxKeys)
      )
        return false;
      sources.set(key, count + 1);
      total++;
      return true;
    },
    get sourceCount() {
      return sources.size;
    },
  });
}
