import { applicationRuntime } from './context.mjs';
export const prisma = new Proxy({}, {
  get(_, key) {
    const db = applicationRuntime.getStore()?.prisma;
    if (!db) throw new Error('Database accessed outside application runtime');
    const value = db[key];
    return typeof value === 'function' ? value.bind(db) : value;
  },
});
