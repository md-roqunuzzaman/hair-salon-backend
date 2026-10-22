import { createHash, timingSafeEqual } from 'node:crypto';
import { capture } from './snapshot.mjs';
const reply = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const authenticated = (request,env) => {
  const token = env.MAINTENANCE_TOKEN;
  if (!/^[a-f0-9]{64,128}$/.test(token ?? '')) return false;
  const provided = request.headers.get('authorization') ?? '';
  return timingSafeEqual(createHash('sha256').update(provided).digest(),createHash('sha256').update(`Bearer ${token}`).digest());
};
export class SalonDatabase {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; }
  async fetch(request) {
    if (!authenticated(request,this.env)) return reply({error:'UNAUTHORIZED'},401);
    if (request.method !== 'GET') return reply({error:'METHOD_NOT_ALLOWED'},405);
    const identity = this.ctx.id.toString();
    if (request.headers.get('x-maintenance-object-id') !== identity) return reply({error:'OBJECT_ID_MISMATCH'},409);
    try {
      const path=new URL(request.url).pathname;
      if (path === '/__maintenance/bookmark') return reply({identity,bookmark:await this.ctx.storage.getCurrentBookmark()});
      if (path !== '/__maintenance/export') return reply({error:'NOT_FOUND'},404);
      const payload=JSON.stringify(await capture(this.ctx.storage,identity));
      // Bounded one-shot export; do not silently truncate. Large datasets require a reviewed streaming design.
      if (new TextEncoder().encode(payload).length > 16*1024*1024) return reply({error:'EXPORT_TOO_LARGE'},413);
      const sha256=createHash('sha256').update(payload).digest('hex');
      return reply({sha256,payload});
    } catch(error) {
      const safe=['STORAGE_CHANGED_DURING_EXPORT','UNSUPPORTED_SCHEMA','UNSUPPORTED_NUMBER','UNSUPPORTED_VALUE','CYCLIC_VALUE','DATABASE_FOREIGN_KEYS_FAILED'];
      return reply({error:safe.includes(error.message)?error.message:'EXPORT_UNAVAILABLE'},503);
    }
  }
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if (!path.startsWith('/__maintenance/')) return reply({error:'MAINTENANCE'},503);
    if (!authenticated(request,env)) return reply({error:'UNAUTHORIZED'},401);
    if (request.method !== 'GET') return reply({error:'METHOD_NOT_ALLOWED'},405);
    if (!['/__maintenance/target','/__maintenance/bookmark','/__maintenance/export'].includes(path)) return reply({error:'NOT_FOUND'},404);
    const id=env.SALON_DB.idFromName('salon-v1');
    // Resolves identity without obtaining a stub or invoking the object.
    if (path === '/__maintenance/target') return reply({identity:id.toString(),objectName:'salon-v1'});
    if (request.headers.get('x-maintenance-object-id') !== id.toString()) return reply({error:'OBJECT_ID_MISMATCH'},409);
    return env.SALON_DB.get(id).fetch(request);
  },
  scheduled() {},
};
