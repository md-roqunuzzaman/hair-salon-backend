// Tagged values avoid precision loss and preserve binary/KV types. Cycles fail closed.
export function pack(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw Error('UNSUPPORTED_NUMBER');
    return { t: 'number', v: Object.is(value, -0) ? '-0' : String(value) };
  }
  if (typeof value === 'bigint') return { t: 'bigint', v: String(value) };
  if (value === undefined) return { t: 'undefined' };
  if (seen.has(value)) throw Error('CYCLIC_VALUE');
  seen.add(value);
  let result;
  if (value instanceof Date) result = { t: 'date', v: value.toISOString() };
  else if (value instanceof ArrayBuffer) result = { t: 'bytes', v: Array.from(new Uint8Array(value)) };
  else if (Array.isArray(value)) result = { t: 'array', v: value.map(v => pack(v, seen)) };
  else if (value instanceof Map) result = { t: 'map', v: [...value].map(([k,v]) => [pack(k,seen),pack(v,seen)]) };
  else if (value instanceof Set) result = { t: 'set', v: [...value].map(v => pack(v,seen)) };
  else if (Object.getPrototypeOf(value) === Object.prototype) result = { t: 'object', v: Object.entries(value).map(([k,v]) => [k,pack(v,seen)]) };
  else throw Error('UNSUPPORTED_VALUE');
  seen.delete(value);
  return result;
}
export function unpack(value) {
  if (value === null || typeof value !== 'object') return value;
  switch (value.t) {
    case 'number': return Number(value.v);
    case 'bigint': return BigInt(value.v);
    case 'undefined': return undefined;
    case 'date': return new Date(value.v);
    case 'bytes': return Uint8Array.from(value.v).buffer;
    case 'array': return value.v.map(unpack);
    case 'map': return new Map(value.v.map(([k,v]) => [unpack(k),unpack(v)]));
    case 'set': return new Set(value.v.map(unpack));
    case 'object': return Object.fromEntries(value.v.map(([k,v]) => [k,unpack(v)]));
    default: throw Error('INVALID_TAG');
  }
}
