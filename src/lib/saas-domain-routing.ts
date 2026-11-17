export const reservedSubdomains=new Set(['www','app','api','admin','platform','login','auth','mail','smtp','imap','pop','autodiscover','ns1','ns2','status','support','billing','cdn','static','assets','docs','help']);
export type DomainEntry={status:307;url:string}|{status:421}|{status:200;path:string;slug:string;host:string};
export async function domainEntry(
 request:{host:string;pathname:string;method:string},
 config:{canonical:string;trustedHosts:string[];development:boolean;tenantRoot?:string},
 resolve:(host:string)=>Promise<string|null>,
 resolveSubdomain?:(label:string)=>Promise<string|null>,
):Promise<DomainEntry|null>{
 let canonical:URL;try{canonical=new URL(config.canonical);}catch{return {status:421};}
 const host=request.host.toLowerCase(),path=request.pathname;
 if(host===canonical.host.toLowerCase()||config.trustedHosts.map(h=>h.toLowerCase()).includes(host))return null;
 if(config.development&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))return null;
 const localCanonical=config.development&&canonical.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(canonical.hostname);
 if((canonical.protocol!=='https:'&&!localCanonical)||canonical.username||canonical.password||!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||!['GET','HEAD'].includes(request.method))return {status:421};
 let slug:string|null=null;const root=config.tenantRoot?.toLowerCase();
 if(root&&(host===root||host.endsWith('.'+root))){
  const label=host.slice(0,-root.length-1);
  if(!label||label.includes('.')||reservedSubdomains.has(label)||!resolveSubdomain)return {status:421};
  slug=await resolveSubdomain(label).catch(()=>null);
 }else slug=await resolve(host).catch(()=>null);
 if(!slug||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))return {status:421};
 if(['/login','/manage','/workspaces'].includes(path))return {status:307,url:new URL(`/login?next=${encodeURIComponent(`/company/${slug}`)}`,canonical.origin).toString()};
 // Public aliases never receive authentication callbacks, private APIs or mutations.
 const base=`/store/${slug}`;let target:string;
 if(path==='/')target=base;
 else if(path==='/cart'||path==='/checkout')target=base+'/cart';
 else if(/^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path))target=base+path;
 else if(path===base||path===base+'/cart'||path===base+'/checkout')target=path.endsWith('/checkout')?base+'/cart':path;
 else if(path.startsWith(base+'/products/')&&/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path.slice((base+'/products').length)))target=path;
 else if(path===`/api/tenant/${slug}/catalogue`||/^\/api\/saas\/logo\/[0-9a-f-]{36}$/.test(path)||path.startsWith('/_next/')||path.startsWith('/fonts/')||path.startsWith('/brand/')||path.startsWith('/icons/')||['/favicon.ico','/icon.svg','/window.svg','/robots.txt'].includes(path))target=path;
 else return {status:421};
 return {status:200,path:target,slug,host};
}
