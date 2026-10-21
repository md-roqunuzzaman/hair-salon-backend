import { AsyncLocalStorage } from 'node:async_hooks';
export const applicationRuntime = new AsyncLocalStorage();
