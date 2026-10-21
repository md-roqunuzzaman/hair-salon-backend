import { applicationRuntime } from './context.mjs';
export const redisClient = new Proxy({}, {
  get(_, key) {
    const sessions = applicationRuntime.getStore()?.redis;
    if (!sessions) throw new Error('Sessions accessed outside application runtime');
    const value = sessions[key];
    return typeof value === 'function' ? value.bind(sessions) : value;
  },
});
export const connectRedis = async () => {};
