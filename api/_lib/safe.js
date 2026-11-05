// Safe lookups in plain-object maps built from storage: a key sent by a client such as "__proto__" or
// "toString" must never resolve to Object.prototype (it is never a player, team or entry).
export const own = (map, k) => (typeof k === 'string' && map && Object.hasOwn(map, k) ? map[k] : undefined);
export const badKey = (k) => typeof k !== 'string' || k in Object.prototype;
