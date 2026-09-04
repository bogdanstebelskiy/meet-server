// Minimal in-memory double for the subset of the ioredis API RoomsService
// uses. Real Redis behavior (persistence, actual TTL expiry, atomicity) is
// exercised by the e2e tier - this only needs to prove RoomsService issues
// the right commands with the right data.
export class FakeRedis {
  private readonly strings = new Map<string, string>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _mode: 'EX',
    ttlSeconds: number,
  ): Promise<'OK'> {
    this.strings.set(key, value);
    this.ttls.set(key, ttlSeconds);
    return 'OK';
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const isNewField = !hash.has(field);
    hash.set(field, value);
    this.hashes.set(key, hash);
    return isNewField ? 1 : 0;
  }

  async hdel(key: string, field: string): Promise<number> {
    return (this.hashes.get(key)?.delete(field) ?? false) ? 1 : 0;
  }

  async hkeys(key: string): Promise<string[]> {
    return [...(this.hashes.get(key)?.keys() ?? [])];
  }

  async hlen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    this.ttls.set(key, ttlSeconds);
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) deleted++;
      if (this.hashes.delete(key)) deleted++;
      this.ttls.delete(key);
    }
    return deleted;
  }

  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }
}
