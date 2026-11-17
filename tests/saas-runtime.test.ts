import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {domainEntry} from '../src/lib/saas-domain-routing';
import {handoffCart,handoffUrl} from '../src/lib/cart-handoff';
import {prepareFile} from '../src/lib/saas-files';
import {workspacePath} from '../src/lib/workspace-path';
import {authLanding} from '../src/lib/auth-landing';
import {boundedJson} from '../src/lib/saas-server';
import {paymentOrigin} from '../src/lib/payment-origin';
import {vi,afterEach} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,existsSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {targetHash,validateEvidence,requireSaasEvidence}=require('../scripts/saas-migration-gate.cjs');
const {configurationProblems:saasHostingProblems,databaseMatchesProject,stagingTargetProblem}=require('../scripts/saas-hosting-preflight.cjs');
const {removeBuildDotenv}=require('../scripts/package-saas.cjs');
afterEach(()=>vi.unstubAllEnvs());
it('excludes build dotenv defaults from SaaS standalone output without changing other files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'saas-package-'));try{
  writeFileSync(join(dir,'.env.production'),'NEXT_PUBLIC_SUPABASE_URL=https://previous.example');writeFileSync(join(dir,'.env.local'),'PRIVATE_FIXTURE=synthetic');writeFileSync(join(dir,'server.js'),'// fixture');
  expect(removeBuildDotenv(dir).sort()).toEqual(['.env.local','.env.production']);expect(existsSync(join(dir,'.env.production'))).toBe(false);expect(readFileSync(join(dir,'server.js'),'utf8')).toBe('// fixture');
 }finally{for(const name of ['server.js','.env.production','.env.local'])if(existsSync(join(dir,name)))unlinkSync(join(dir,name));rmdirSync(dir);}
});
it('pins production payment traffic and permits only loopback test credentials in development',()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('PAYSTACK_TEST_API_ORIGIN','http://127.0.0.1:54329');expect(paymentOrigin('sk_live_example')).toBe('https://api.paystack.co');
 vi.stubEnv('NODE_ENV','development');expect(paymentOrigin('sk_test_example')).toBe('http://127.0.0.1:54329');expect(()=>paymentOrigin('sk_live_example')).toThrow();vi.stubEnv('PAYSTACK_TEST_API_ORIGIN','https://attacker.example');expect(()=>paymentOrigin('sk_test_example')).toThrow();
});
it('prevents SaaS hosting with the earlier flagship Supabase project configuration',()=>{
 const env={NEXT_PUBLIC_SITE_URL:'https://saas.example.com',NEXT_PUBLIC_SUPABASE_URL:'https://iipbmwpigedfslqybxmg.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_fixture',LOCAL_DEMO:'false',SAAS_PLATFORM_SITE:'true'};expect(saasHostingProblems(env)).toEqual([]);expect(saasHostingProblems({...env,NEXT_PUBLIC_SUPABASE_URL:'https://itdpkfnuyxzqswctlsar.supabase.co'})).toContain('NEXT_PUBLIC_SUPABASE_URL must identify the designated project iipbmwpigedfslqybxmg.');
 const jwt='header.'+Buffer.from(JSON.stringify({ref:'another-project',role:'service_role'})).toString('base64url')+'.signature';expect(saasHostingProblems({...env,SUPABASE_SERVICE_ROLE_KEY:jwt},'runtime')).toContain('The service-role JWT belongs to another project or role.');
});
it('binds migration/load profiles to exact Supabase direct or pooler project identities',()=>{
 const ref='iipbmwpigedfslqybxmg';expect(databaseMatchesProject(`postgres://postgres@db.${ref}.supabase.co/postgres`,ref)).toBe(true);expect(databaseMatchesProject(`postgres://postgres.${ref}@aws-0-eu.pooler.supabase.com:5432/postgres`,ref)).toBe(true);
 for(const connection of [`postgres://postgres@db.itdpkfnuyxzqswctlsar.supabase.co/postgres`,`postgres://postgres.${ref}@attacker.example/postgres`,`postgres://postgres@db.${ref}.supabase.co.attacker.example/postgres`])expect(databaseMatchesProject(connection,ref)).toBe(false);
 const direct=`postgres://postgres@db.${ref}.supabase.co/postgres`,pooler=`postgres://postgres.${ref}@aws-0-eu.pooler.supabase.com:5432/postgres`;
 expect(stagingTargetProblem(pooler,ref,direct)).toContain('Refusing');expect(stagingTargetProblem(direct,ref,pooler)).toContain('Refusing');expect(stagingTargetProblem(direct,ref,'postgres://postgres@db.itdpkfnuyxzqswctlsar.supabase.co/postgres')).toBeNull();expect(stagingTargetProblem('',ref,direct)).toContain('ready to run');
});
it('resolves only verified tenant entrypoints and discards untrusted paths and ports',async()=>{
 const config={canonical:'https://platform.example.com',trustedHosts:['backup.example.com'],development:false};const resolve=async(host:string)=>host==='acme.example.com'?'acme':null;
 expect(await domainEntry({host:'platform.example.com',pathname:'/api/saas',method:'POST'},config,resolve)).toBeNull();
 expect(await domainEntry({host:'acme.example.com',pathname:'/',method:'GET'},config,resolve)).toEqual({status:200,path:'/store/acme',slug:'acme',host:'acme.example.com'});
 for(const r of [{host:'unknown.example.com',pathname:'/',method:'GET'},{host:'acme.example.com:443',pathname:'/',method:'GET'},{host:'acme.example.com',pathname:'/api/saas',method:'POST'},{host:'acme.example.com',pathname:'/auth/confirm',method:'GET'}])expect(await domainEntry(r,config,resolve)).toEqual({status:421});
});
it('maps assigned business subdomains and blocks cross-company paths and reserved labels',async()=>{
 const config={canonical:'https://app.example.net',trustedHosts:[],development:false,tenantRoot:'nexzekbizhub.com'};
 const own=async(label:string)=>label==='nex'?'nex':null;
 expect(await domainEntry({host:'nex.nexzekbizhub.com',pathname:'/products/rice',method:'GET'},config,async()=>null,own)).toEqual({status:200,path:'/store/nex/products/rice',slug:'nex',host:'nex.nexzekbizhub.com'});
 for(const [host,path,method]of [['app.nexzekbizhub.com','/','GET'],['unknown.nexzekbizhub.com','/','GET'],['nested.nex.nexzekbizhub.com','/','GET'],['nex.nexzekbizhub.com','/store/another-company','GET'],['nex.nexzekbizhub.com','/api/tenant/nex/checkout','POST'],['nex.nexzekbizhub.com','/auth/confirm','GET']])expect(await domainEntry({host,pathname:path,method},config,async()=>null,own)).toEqual({status:421});
 expect(await domainEntry({host:'nex.nexzekbizhub.com',pathname:'/login',method:'GET'},config,async()=>null,own)).toEqual({status:307,url:'https://app.example.net/login?next=%2Fcompany%2Fnex'});
});
it('transfers only bounded public cart choices to a trusted secure checkout origin',()=>{
 const lines=[{id:'public-product',quantity:2,options:{Size:'Small'}}];const url=new URL(handoffUrl('https://app.example.net','nex',lines));expect(url.pathname).toBe('/store/nex/continue');expect(JSON.parse(new URLSearchParams(url.hash.slice(1)).get('bag')!)).toEqual(lines);
 expect(()=>handoffUrl('https://user:password@attacker.example','nex',lines)).toThrow();expect(()=>handoffUrl('javascript:alert(1)','nex',lines)).toThrow();expect(()=>handoffCart.parse([{...lines[0],quantity:0}])).toThrow();expect(()=>handoffCart.parse([{...lines[0],price_kobo:1}])).toThrow();
});
it('bounds streamed JSON independently of supplied content length',async()=>{
 await expect(boundedJson(new Request('https://example.com',{method:'POST',body:JSON.stringify({value:'x'.repeat(100)})}),50)).rejects.toThrow('too large');
 expect(await boundedJson(new Request('https://example.com',{method:'POST',body:'{"ok":true}'}))).toEqual({ok:true});
});
it('decodes and optimizes real images, strips metadata, and rejects fake signatures and SVG',async()=>{
 const image=await sharp({create:{width:2400,height:1200,channels:4,background:'#2457c5'}}).png().toBuffer();
 const output=await prepareFile(image,'image/png','logos');expect(output.mime).toBe('image/webp');const metadata=await sharp(output.buffer).metadata();expect(metadata.width).toBe(1600);expect(metadata.height).toBe(800);expect(metadata.exif).toBeUndefined();
 await expect(prepareFile(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20)]),'image/png','logos')).rejects.toThrow('valid single-frame');
 await expect(prepareFile(Buffer.from('<svg onload="alert(1)"></svg>'),'image/svg+xml','logos')).rejects.toThrow('SVG');
 await expect(prepareFile(Buffer.from('%PDF-1.7\n%%EOF'),'application/pdf','logos')).rejects.toThrow('image');
});
it('requires target-bound, recent, checksum-verified backup and restore evidence before existing-database SaaS migrations',()=>{
 const target=targetHash('postgres://user:secret@db.example.com/test');expect(target).toBe(targetHash('postgres://user:other@db.example.com/test'));expect(target).not.toBe(targetHash('postgres://other:secret@db.example.com/test'));
 const buffer=Buffer.from('isolated database backup'),now=Date.now();const evidence={target_sha256:target,restored_at:new Date(now-1000).toISOString(),restoration_verified:true,record_counts_verified:true,ownership_reviewed:true,rls_tests_passed:true,storage_backup_verified:true,backup_file:process.platform==='win32'?'C:\\private\\database.dump':'/private/database.dump',backup_sha256:createHash('sha256').update(buffer).digest('hex')};
 expect(validateEvidence(evidence,target,()=>buffer,now)).toBe(true);
 for(const changed of [{...evidence,target_sha256:'other'},{...evidence,restored_at:new Date(now-86401000).toISOString()},{...evidence,ownership_reviewed:false},{...evidence,backup_sha256:'0'.repeat(64)}])expect(()=>validateEvidence(changed,target,()=>buffer,now)).toThrow();
 expect(()=>requireSaasEvidence([{name:'049_saas.sql'}],'postgres://user@host/test','',true)).toThrow('SAAS_MIGRATION_EVIDENCE');
 expect(()=>requireSaasEvidence([{name:'049_saas.sql'}],'postgres://user@host/test','',false)).not.toThrow();
});
it('allows company settings and onboarding returns without permitting arbitrary redirect URLs',()=>{
 for(const p of ['/start','/company/acme/settings','/platform/billing','/billing/return?reference=edge-saas-30000000-0000-4000-8000-000000000001'])expect(workspacePath(p)).toBe(p);
 for(const p of ['/start?next=https://evil.example','/company/acme/settings/../../admin','//evil.example','/billing/return?reference=evil'])expect(workspacePath(p)).toBeUndefined();
 expect(authLanding('https://example.com/?code=verified-code&next=/start')).toEqual({kind:'redirect',href:'/auth/confirm?code=verified-code&next=%2Fstart'});
});
