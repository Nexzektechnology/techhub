import {createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {NextResponse,type NextRequest} from 'next/server';
import {domainEntry} from '@/lib/saas-domain-routing';
export async function proxy(request:NextRequest){
 const requestHeaders=new Headers(request.headers);
 // These are internal routing facts, never authority supplied by a visitor.
 requestHeaders.delete('x-saas-public-tenant');requestHeaders.delete('x-saas-public-host');
 let publicPath:string|null=null;
 if(process.env.SAAS_DOMAIN_ROUTING==='true'){
  const rpc=async(name:string,args:Record<string,string>)=>{if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return null;const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const r=await db.rpc(name,args);return r.error?null:r.data as string|null;};
  const entry=await domainEntry({host:request.headers.get('host')||'',pathname:request.nextUrl.pathname,method:request.method},
   {canonical:process.env.NEXT_PUBLIC_SITE_URL||'',trustedHosts:(process.env.SAAS_TRUSTED_APP_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),development:process.env.NODE_ENV!=='production',tenantRoot:process.env.SAAS_TENANT_ROOT_DOMAIN},
   host=>rpc('saas_resolve_host',{p_host:host}),label=>rpc('saas_resolve_subdomain',{p_label:label}));
  if(entry?.status===421||entry?.status===307){const r=entry.status===307?NextResponse.redirect(entry.url,307):new NextResponse('Domain unavailable',{status:421});r.headers.set('Cache-Control','private, no-store');return r;}
  if(entry?.status===200){publicPath=entry.path;requestHeaders.set('x-saas-public-tenant',entry.slug);requestHeaders.set('x-saas-public-host',entry.host);requestHeaders.delete('cookie');}
 }
 // Only this generic public shell is cached. Never run session refresh or
 // attach private account HTML/cookies to an offline asset response.
 if(['/bizhub-offline.html','/bizhub-offline.js','/bizhub-offline.css','/bizhub.webmanifest','/bizhub-sw.js','/bizhub.svg'].includes(request.nextUrl.pathname)){
  const response=NextResponse.next({request:{headers:requestHeaders}});
  response.headers.set('Cache-Control','public, max-age=0, must-revalidate');
  response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
  if(request.nextUrl.pathname==='/bizhub-sw.js'){response.headers.set('Cache-Control','no-cache, no-store, must-revalidate');response.headers.set('Service-Worker-Allowed','/');}
  return response;
 }
 const nonce=Buffer.from(crypto.randomUUID()).toString('base64'),dev=process.env.NODE_ENV!=='production';
 const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}`,"style-src 'self' 'unsafe-inline'","img-src 'self' https: data: blob:","font-src 'self'","object-src 'none'","base-uri 'self'","form-action 'self'","frame-src 'self'","frame-ancestors 'self'",`connect-src 'self'${dev?' ws: wss:':''}`,"worker-src 'self'",...(request.nextUrl.protocol==='https:'&&!dev?['upgrade-insecure-requests']:[])].join('; ');
 requestHeaders.set('x-nonce',nonce);requestHeaders.set('Content-Security-Policy',csp);
 function next(){if(publicPath){const url=new URL(request.url);url.pathname=publicPath;return NextResponse.rewrite(url,{request:{headers:requestHeaders}});}return NextResponse.next({request:{headers:requestHeaders}});}
 let response=next();
 if(!publicPath&&process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY){
  const db=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>request.cookies.getAll(),setAll:items=>{items.forEach(c=>request.cookies.set(c.name,c.value));requestHeaders.set('cookie',request.cookies.toString());response=next();items.forEach(c=>response.cookies.set(c.name,c.value,c.options));}}});await db.auth.getUser();
 }
 response.headers.set('Content-Security-Policy',csp);
 if(/^\/(auth|reset-password)(\/|$)/.test(request.nextUrl.pathname))response.headers.set('Referrer-Policy','no-referrer');
 if(request.nextUrl.pathname==='/app-sw.js'){response.headers.set('Cache-Control','no-cache, no-store, must-revalidate');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'");}
 if(publicPath||/^\/(start|billing|admin|account|merchant|driver|company|field|platform|workspaces|checkout|forgot-password|reset-password|auth|theme-preview|api)(\/|$)/.test(request.nextUrl.pathname))response.headers.set('Cache-Control','private, no-store');
 return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|fonts|icon.svg).*)']};
