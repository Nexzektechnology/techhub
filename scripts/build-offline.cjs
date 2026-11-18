// Build a public shell only. Private records live in passphrase-encrypted IndexedDB.
const fs=require('node:fs'),crypto=require('node:crypto');
require('esbuild').buildSync({entryPoints:['src/offline/main.tsx'],outfile:'public/bizhub-offline.js',bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const assets=['/bizhub-offline.html','/bizhub-offline.js','/bizhub-offline.css','/bizhub.webmanifest','/bizhub.svg'];
const hash=crypto.createHash('sha256');for(const asset of assets)hash.update(fs.readFileSync('public'+asset));const version='bizhub-offline-'+hash.digest('hex').slice(0,16);
fs.writeFileSync('public/bizhub-sw.js',`const VERSION=${JSON.stringify(version)},ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('bizhub-offline-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(ASSETS.includes(url.pathname)){event.respondWith(caches.open(VERSION).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)));return;}
 if(event.request.mode==='navigate'&&!/^\\/(api|auth|login|register|reset-password|forgot-password|billing)(\\/|$)/.test(url.pathname)){event.respondWith(fetch(event.request).catch(()=>caches.open(VERSION).then(cache=>cache.match('/bizhub-offline.html'))));}
});
`);
console.log('Built public offline shell '+version+'; private HTML/API responses are never cached.');
