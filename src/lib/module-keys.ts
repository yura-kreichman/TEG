// Client-safe half of src/lib/modules.ts — just the open list of module keys,
// no Prisma import. Split out because admin/packages and admin/tenants/[id]
// are client components that only need MODULE_KEYS for their checkbox/switch
// UI; importing it from modules.ts dragged @/lib/prisma (and pg's Node-only
// `tls`/`util` requires) into the browser bundle and broke the build (found
// via dev-server.log "Module not found: Can't resolve 'tls'" 2026-07-10).
export const MODULE_KEYS = ["counters", "money", "work_time", "tasks"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
