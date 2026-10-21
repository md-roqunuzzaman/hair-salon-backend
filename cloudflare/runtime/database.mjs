import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '../../generated/sqlite/client.ts';
import { Prisma } from '../../generated/sqlite/client.ts';
import metadata from './model-metadata.json';
import { AppError } from '../../src/app/utils/app-error.ts';

// Only the adapter's SQL/result conversion is reused. Atomicity comes from the
// enclosing Durable Object storage transaction, never D1's no-op transactions.
function sqliteBinding(storage) {
  return {
    prepare(sql) {
      let args = [];
      const execute = () => {
        try { return storage.sql.exec(sql, ...args); }
        catch (error) {
          // The upstream adapter logs driver exceptions before wrapping them.
          // Retain only recognized constraint metadata, never SQL/provider text.
          const message = error.message.replace(/: SQLITE_[A-Z_]+\s*$/, '');
          const safe = /^(?:(?:UNIQUE|PRIMARY KEY) constraint failed: [\w., ]+|FOREIGN KEY constraint failed|NOT NULL constraint failed: [\w.]+|CHECK constraint failed(?:: \w+)?|Money precision exceeded|database is (?:locked|busy))$/.test(message);
          throw new Error(safe ? message : 'SQLite operation failed');
        }
      };
      const statement = {
        bind(...values) { args = values; return statement; },
        async raw() {
          const cursor = execute();
          const columns = [...cursor.columnNames];
          return [columns, ...cursor.raw().toArray()];
        },
        async run() {
          const cursor = execute();
          cursor.toArray();
          const changes = storage.sql.exec('SELECT changes() AS n').one().n;
          return { success: true, results: [], meta: { changes } };
        },
      };
      return statement;
    },
    async exec(sql) { storage.sql.exec(sql).toArray(); },
  };
}

const primitive = value => value === null || typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array;
function minor(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(minor);
  if (typeof value === 'object' && !(value instanceof Prisma.Decimal)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, minor(item)]));
  }
  const cents = new Prisma.Decimal(value.toString()).mul(100);
  if (!cents.isFinite() || !cents.isInteger() || cents.abs().gt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError('Money must be finite, exact to two decimals and within safe integer range', 400);
  }
  return BigInt(cents.toFixed(0));
}

function input(model, value, storage) {
  if (primitive(value) || value instanceof Prisma.Decimal) return value;
  if (Array.isArray(value)) return value.map(item => input(model, item, storage));
  const info = metadata[model];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (item === undefined) return [key, item];
    if (['orderBy', 'distinct', 'by', '_count', '_sum', '_avg', '_min', '_max'].includes(key)) return [key, item];
    if (key === 'select' || key === 'include') return [key, Object.fromEntries(Object.entries(item).map(([field, selection]) =>
      [field, info.relations[field] && typeof selection === 'object' ? input(info.relations[field], selection, storage) : selection]))];
    if (info.money[key]) return [key, minor(item)];
    if (info.arrays.includes(key)) return [key, item?.set ?? item];
    if (info.relations[key]) return [key, input(info.relations[key], item, storage)];
    if (item?.mode === 'insensitive') {
      // Resolve the requested string predicate inside the same storage
      // transaction. SQLite's default collation does not fold Unicode.
      if (info.scalars[key] !== 'String') throw new Error('Invalid string field');
      const values = storage.sql.exec(`SELECT DISTINCT "${key}" AS value FROM "${model}"`).toArray();
      const matches = values.filter(({ value: candidate }) => {
        if (typeof candidate !== 'string') return false;
        const text = candidate.toLowerCase();
        return Object.entries(item).every(([operator, operand]) => {
          if (operator === 'mode') return true;
          const needle = String(operand).toLowerCase();
          if (operator === 'contains') return text.includes(needle);
          if (operator === 'equals') return text === needle;
          if (operator === 'startsWith') return text.startsWith(needle);
          if (operator === 'endsWith') return text.endsWith(needle);
          throw new Error(`Unsupported case insensitive predicate: ${operator}`);
        });
      }).map(row => row.value);
      return [key, { in: matches }];
    }
    if (info.scalars[key]) return [key, item];
    return [key, input(model, item, storage)];
  }));
}

function output(model, value, aggregate = false) {
  if (primitive(value) || value instanceof Prisma.Decimal) return value;
  if (Array.isArray(value)) return value.map(item => output(model, item, aggregate));
  const info = metadata[model];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === '_count') return [key, item];
    if (info.money[key] && item !== null) return [key, new Prisma.Decimal(item.toString()).div(100)];
    if (info.relations[key]) return [key, output(info.relations[key], item)];
    if (['_sum', '_avg', '_min', '_max'].includes(key)) return [key, output(model, item, true)];
    return [key, item];
  }));
}

export function createDatabase(storage) {
  const scope = new AsyncLocalStorage();
  const factory = new PrismaD1(sqliteBinding(storage));
  const connect = factory.connect.bind(factory);
  factory.connect = async () => {
    const adapter = await connect();
    adapter.startTransaction = async () => {
      if (!scope.getStore()) throw new Error('SQLite query escaped its Durable Object transaction');
      return {
        provider: adapter.provider, adapterName: adapter.adapterName,
        options: { usePhantomQuery: true },
        queryRaw: adapter.queryRaw.bind(adapter), executeRaw: adapter.executeRaw.bind(adapter),
        commit: async () => {}, rollback: async () => {},
      };
    };
    return adapter;
  };
  const client = new PrismaClient({ adapter: factory });
  const atomic = callback => scope.getStore() ? callback() : storage.transaction(() => scope.run(true, callback));
  const lazy = callback => {
    let promise;
    const run = () => promise ??= Promise.resolve().then(() => atomic(callback));
    return {
      then(resolve, reject) { return run().then(resolve, reject); },
      catch(reject) { return run().catch(reject); },
      finally(callbackFinally) { return run().finally(callbackFinally); },
      [Symbol.toStringTag]: 'PrismaPromise',
    };
  };
  const models = Object.fromEntries(Object.keys(metadata).map(model => [model[0].toLowerCase() + model.slice(1), model]));
  const delegates = new Map();
  const facade = new Proxy({}, {
    get(_, key) {
      if (key === '$transaction') return (operation) => atomic(async () =>
        typeof operation === 'function' ? operation(facade) : Promise.all(operation));
      if (key === '$connect') return () => client.$connect();
      if (key === '$disconnect') return () => client.$disconnect();
      if (key === '$queryRaw' || key === '$executeRaw') return (strings, ...values) => lazy(async () => {
        const sql = typeof strings.sql === 'string' ? strings.sql : strings.join('?');
        const parameters = Array.isArray(strings.values) ? strings.values : values;
        // All calls are serialized and enclosed in storage transactions. SQLite
        // locks replace the original PostgreSQL row lock, never an unlocked read.
        const normalized = sql.replace(/\s+FOR\s+UPDATE\s*;?\s*$/i, '');
        return key === '$queryRaw' ? client.$queryRawUnsafe(normalized, ...parameters) : client.$executeRawUnsafe(normalized, ...parameters);
      });
      if (!models[key]) throw new Error(`Unsupported database operation: ${String(key)}`);
      if (!delegates.has(key)) delegates.set(key, new Proxy({}, {
        get(_, operation) {
          return args => lazy(async () => {
            const model = models[key];
            return output(model, await client[key][operation](input(model, args, storage)));
          });
        },
      }));
      return delegates.get(key);
    },
  });
  return facade;
}
