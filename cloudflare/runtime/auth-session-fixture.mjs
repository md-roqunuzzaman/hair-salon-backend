// Disposable test control only; never imported by the production Worker entry.
const controls = new WeakMap();
export async function authSessionTestControl(sessions, storage, body) {
  let control = controls.get(sessions);
  if (!control) {
    control = { fault: null, trace: [] };
    controls.set(sessions, control);
    for (const name of ['get', 'set', 'del', 'eval']) {
      const original = sessions[name].bind(sessions);
      sessions[name] = async (...args) => {
        const key = typeof args[0] === 'string' ? args[0] : '';
        const options = args[1];
        const revoke = name === 'eval' && options.keys.length === 0 && options.arguments[0]?.startsWith('auth:refresh:');
        const cleanup = name === 'eval' && options.keys[0]?.startsWith('password-reset-token:');
        const rotate = name === 'eval' && options.keys.length === 2 && options.keys.every(k => k.startsWith('auth:refresh:'));
        if (revoke) control.trace.push('revoke');
        if (cleanup) control.trace.push('reset-token-cleanup');
        const shouldFail =
          (control.fault === 'read' && name === 'get' && key.startsWith('auth:refresh:')) ||
          (control.fault === 'write' && name === 'set' && key.startsWith('auth:refresh:')) ||
          (control.fault === 'delete' && name === 'del' && key.startsWith('auth:refresh:')) ||
          (control.fault === 'rotate' && rotate) || (control.fault === 'revoke' && revoke) ||
          (control.fault === 'reset-cleanup' && cleanup);
        if (shouldFail) throw new Error('synthetic internal storage error; never public');
        return original(...args);
      };
    }
  }
  if ('fault' in body) control.fault = body.fault;
  if (body.clearTrace) control.trace.length = 0;
  let result;
  switch (body.operation) {
    case 'set': result = await sessions.set(body.key, body.value, body.options); break;
    case 'get': result = await sessions.get(body.key); break;
    case 'del': result = await sessions.del(body.key); break;
    case 'ttl': result = await sessions.ttl(body.key); break;
    case 'expire': storage.sql.exec('UPDATE _Sessions SET expires = 0 WHERE key = ?', body.key).toArray(); break;
    case 'eval': result = await sessions.eval(body.script, body.options); break;
    case 'parallel-eval': result = await Promise.all(body.options.map(options => sessions.eval(body.script, options))); break;
    case 'parallel-set': result = await Promise.all(body.values.map(value => sessions.set(body.key, value, body.options))); break;
  }
  return { result: result ?? null, trace: [...control.trace] };
}
