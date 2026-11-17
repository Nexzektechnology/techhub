// Only known checkout and workspace routes can be used as sign-in return destinations.
export function workspacePath(value:unknown):string|undefined{
  if(typeof value==='string'&&value.length<=220&&(/^\/company\/[a-z0-9]+(?:-[a-z0-9]+)*\/commerce$/.test(value)||/^\/store\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:checkout|confirmation\?reference=edge-tenant-[0-9a-f-]{36})$/.test(value)))return value;
  return typeof value==='string'&&value.length<=200&&(/^\/(?:start|checkout|staff|driver|merchant|admin(?:\/(?:team|products|inventory|settings))?|platform(?:\/(?:security|billing))?|workspaces|company\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/settings)?|field\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(value)||/^\/billing\/return\?reference=edge-saas-[0-9a-f-]{36}$/.test(value))?value:undefined;
}
export function verificationNext(value:unknown):string|undefined{return value==='/start'||value==='/checkout'||typeof value==='string'&&/^\/store\/[a-z0-9]+(?:-[a-z0-9]+)*\/checkout$/.test(value)&&value.length<=150?value:undefined;}
