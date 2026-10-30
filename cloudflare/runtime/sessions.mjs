export class Sessions {
  constructor(storage) {
    this.storage = storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS _Sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)').toArray();
    storage.sql.exec('CREATE INDEX IF NOT EXISTS _sessions_expiry ON _Sessions(expires)').toArray();
  }
  read(key) {
    const row = this.storage.sql.exec('SELECT value, expires FROM _Sessions WHERE key = ?', key).toArray()[0];
    if (!row) return null;
    if (row.expires !== null && row.expires <= Date.now()) {
      this.storage.sql.exec('DELETE FROM _Sessions WHERE key = ?', key).toArray();
      return null;
    }
    return row;
  }
  async get(key) { return this.read(key)?.value ?? null; }
  async set(key, value, options = {}) {
    if (options.NX && this.read(key)) return null;
    const seconds = options.EX ?? (options.expiration?.type === 'EX' ? options.expiration.value : undefined);
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds <= 0)) throw new Error('Invalid session expiry');
    const expires = seconds === undefined ? null : Date.now() + seconds * 1000;
    this.storage.sql.exec('INSERT INTO _Sessions VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires', key, String(value), expires).toArray();
    return 'OK';
  }
  async del(key) {
    this.storage.sql.exec('DELETE FROM _Sessions WHERE key = ?', key).toArray();
    return this.storage.sql.exec('SELECT changes() AS n').one().n;
  }
  async exists(key) { return this.read(key) ? 1 : 0; }
  async ttl(key) {
    const row = this.read(key);
    return !row ? -2 : row.expires === null ? -1 : Math.max(0, Math.floor((row.expires - Date.now()) / 1000));
  }
  async expire(key, seconds) {
    if (!this.read(key)) return 0;
    this.storage.sql.exec('UPDATE _Sessions SET expires = ? WHERE key = ?', Date.now() + seconds * 1000, key).toArray();
    return 1;
  }
  async incr(key) {
    const row = this.read(key);
    const value = Number(row?.value ?? 0) + 1;
    if (!Number.isSafeInteger(value)) throw new Error('Session counter overflow');
    this.storage.sql.exec('INSERT INTO _Sessions VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value), row?.expires ?? null).toArray();
    return value;
  }
  async getDel(key) {
    return this.storage.transaction(async () => {
      const value = await this.get(key);
      await this.del(key);
      return value;
    });
  }
  async eval(script, options) {
    // Translate only the application's supported Lua operations. Every script
    // is one SQLite transaction, including counters, TTLs and OTP consumption.
    const normalized = script.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    const { keys, arguments: args } = options;
    if (keys.length === 1 && normalized.includes('local count = redis.call("INCR", KEYS[1])')) {
      return this.storage.transaction(async () => {
        const count = await this.incr(keys[0]);
        if (count === 1) await this.expire(keys[0], Number(args[0]));
        return count;
      });
    }
    if (keys.length === 2 && normalized.includes('local count = redis.call("INCR", KEYS[1])') && normalized.includes('local reserved')) {
      return this.storage.transaction(async () => {
        const count = await this.incr(keys[0]);
        if (count === 1) await this.expire(keys[0], Number(args[0]));
        if (count > Number(args[1])) return -1;
        return await this.set(keys[1], '1', { NX: true, EX: Number(args[2]) }) ? 1 : -2;
      });
    }
    if (keys.length === 2 && normalized.includes('redis.call( "SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2]) )')) {
      return this.storage.transaction(async () => {
        await this.set(keys[0], args[0], { EX: Number(args[1]) });
        await this.del(keys[1]);
        return 1;
      });
    }
    if ([2, 3].includes(keys.length) && normalized.includes('local stored = redis.call("GET", KEYS[1])') && normalized.includes('local maxAttempts')) {
      return this.storage.transaction(async () => {
        const stored = await this.get(keys[0]);
        if (stored === null) return -1;
        let attempts = Number(await this.get(keys[1]) ?? 0);
        const maximum = Number(args[1]);
        if (attempts >= maximum) { await this.del(keys[0]); await this.del(keys[1]); return -2; }
        if (stored !== args[0]) {
          attempts = await this.incr(keys[1]);
          if (attempts === 1) {
            const ttl = await this.ttl(keys[0]);
            if (ttl > 0) await this.expire(keys[1], ttl);
          }
          if (attempts >= maximum) { await this.del(keys[0]); await this.del(keys[1]); return -2; }
          return maximum - attempts;
        }
        if (keys.length === 3) {
          await this.set(keys[2], args[2], { EX: Number(args[3]) });
          await this.del(keys[0]); await this.del(keys[1]);
        }
        return 0;
      });
    }
    if ([1, 2].includes(keys.length) && normalized.includes('if redis.call("GET", KEYS[1]) == ARGV[1] then')) {
      return this.storage.transaction(async () => {
        if (await this.get(keys[0]) === args[0]) {
          const deleted = await this.del(keys[0]);
          if (keys.length === 2) await this.del(keys[1]);
          return keys.length === 2 ? 1 : deleted;
        }
        return keys.length === 2 ? 1 : 0;
      });
    }
    if (options.keys.length === 2 && script.includes('redis.call("SET", KEYS[2]')) {
      return this.storage.transaction(async () => {
        if (!await this.get(options.keys[0])) return 0;
        await this.del(options.keys[0]);
        await this.set(options.keys[1], 'valid', { EX: Number(options.arguments[0]) });
        return 1;
      });
    }
    if (options.keys.length === 0 && script.includes('redis.call("SCAN"')) {
      const pattern = options.arguments[0];
      if (!pattern.endsWith('*') || pattern.slice(0, -1).includes('*')) throw new Error('Unsupported session pattern');
      const prefix = pattern.slice(0, -1);
      this.storage.sql.exec('DELETE FROM _Sessions WHERE substr(key, 1, ?) = ?', prefix.length, prefix).toArray();
      return 1;
    }
    throw new Error('Unsupported session script');
  }
  cleanup() { this.storage.sql.exec('DELETE FROM _Sessions WHERE expires <= ?', Date.now()).toArray(); }
}
