export class LoginAttemptTracker {
  constructor({ limit = 10, windowMs = 15 * 60 * 1000, maxEntries = 10_000, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.buckets = new Map();
  }

  cleanup(now = this.now()) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    while (this.buckets.size > this.maxEntries) this.buckets.delete(this.buckets.keys().next().value);
  }

  bucket(key, now = this.now()) {
    this.cleanup(now);
    const current = this.buckets.get(key);
    if (current && current.resetAt > now) return current;
    const next = { count: 0, resetAt: now + this.windowMs };
    this.buckets.set(key, next);
    return next;
  }

  state(keys, now = this.now()) {
    const entries = keys.map((key) => ({ key, bucket: this.bucket(key, now) }));
    // bucket() cleans before insertion. A multi-key state (IP + identity) can
    // therefore temporarily exceed maxEntries after its final insert. Keep the
    // keys participating in this decision and evict only older buckets.
    const currentKeys = new Set(entries.map(({ key }) => key));
    while (this.buckets.size > this.maxEntries) {
      const oldestNonCurrent = [...this.buckets.keys()].find((key) => !currentKeys.has(key));
      if (!oldestNonCurrent) break; // Guard configurations smaller than this state.
      this.buckets.delete(oldestNonCurrent);
    }
    const retryAfterSeconds = Math.max(0, ...entries.filter(({ bucket }) => bucket.count >= this.limit).map(({ bucket }) => Math.ceil((bucket.resetAt - now) / 1000)));
    return {
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds,
      fail: () => entries.forEach(({ bucket }) => { bucket.count += 1; }),
      // A successful identity proves this account. Do not clear the IP bucket:
      // otherwise one known password would reset an IP-wide spraying defence.
      clearIdentity: () => entries.filter(({ key }) => key.startsWith("identity:")).forEach(({ key }) => this.buckets.delete(key)),
    };
  }
}
