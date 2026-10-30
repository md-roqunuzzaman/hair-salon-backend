import { applicationRuntime } from './context.mjs';

// Captured from Cloudflare's edge-managed header before the Node HTTP adapter.
// Never trust a client-supplied X-Forwarded-For or the adapter's loopback address.
export const registrationClientIp = () => applicationRuntime.getStore()?.clientIp;
