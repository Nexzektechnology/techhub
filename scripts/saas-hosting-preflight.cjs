// Read-only, offline configuration checks for the owner's designated SaaS deployment.
const {readFileSync}=require('node:fs');
const target=JSON.parse(readFileSync(require('node:path').join(__dirname,'../config/saas-deployment.json'),'utf8'));
function configurationProblems(env,mode='build'){
 const errors=[];
 if(!['build','runtime'].includes(mode))errors.push('Mode must be build or runtime.');
 if(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==`https://${target.supabaseProjectRef}.supabase.co`)errors.push(`NEXT_PUBLIC_SUPABASE_URL must identify the designated project ${target.supabaseProjectRef}.`);
 const key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
 if(!(mode==='build'&&env.SAAS_SETUP_MODE==='true'&&!key)&&!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)){
  try{const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(claims.role!=='anon'||claims.ref!==target.supabaseProjectRef)throw Error();}catch{errors.push('Configure the matching project publishable/anon key privately.');}
 }
 try{const u=new URL(env.NEXT_PUBLIC_SITE_URL);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.hostname==='localhost'||require('node:net').isIP(u.hostname))throw Error();}catch{errors.push('NEXT_PUBLIC_SITE_URL must be the public HTTPS application origin.');}
 if(env.LOCAL_DEMO!=='false')errors.push('LOCAL_DEMO must be false on the host.');
 if(env.SAAS_PLATFORM_SITE!=='true')errors.push('SAAS_PLATFORM_SITE must be true for the BizHub deployment.');
 // Vercel's Next preset injects documented public deployment metadata even
 // when automatic system-variable exposure is disabled. Do not allow arbitrary
 // NEXT_PUBLIC_VERCEL_* names: a misspelled secret must still fail closed.
 const publicNames=['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY',...['ENV','TARGET_ENV','URL','BRANCH_URL','PROJECT_PRODUCTION_URL','DEPLOYMENT_ID','PROJECT_ID','GIT_PROVIDER','GIT_REPO_SLUG','GIT_REPO_OWNER','GIT_REPO_ID','GIT_COMMIT_REF','GIT_COMMIT_SHA','GIT_COMMIT_MESSAGE','GIT_COMMIT_AUTHOR_LOGIN','GIT_COMMIT_AUTHOR_NAME','GIT_PREVIOUS_SHA','GIT_PULL_REQUEST_ID','OBSERVABILITY_CLIENT_CONFIG'].map(name=>'NEXT_PUBLIC_VERCEL_'+name)];
 const unexpected=Object.keys(env).filter(k=>k.startsWith('NEXT_PUBLIC_')&&!publicNames.includes(k));
 if(unexpected.length)errors.push('Review unexpected browser-exposed environment settings: '+unexpected.join(', ')+'.');
 if(mode==='runtime'){
  if(env.SAAS_SETUP_MODE==='true')errors.push('A setup preview is not an operational runtime deployment.');
  if(!env.SUPABASE_SERVICE_ROLE_KEY)errors.push('Configure the matching project server-only service key.');
  else if(env.SUPABASE_SERVICE_ROLE_KEY.split('.').length===3){try{const c=JSON.parse(Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1],'base64url').toString());if(c.ref!==target.supabaseProjectRef||c.role!=='service_role')throw Error();}catch{errors.push('The service-role JWT belongs to another project or role.');}}
  for(const name of ['PAYSTACK_SECRET_KEY','SAAS_PAYSTACK_SECRET_KEY'])if(!/^sk_(test|live)_[a-f0-9]{40}$/.test(env[name]||''))errors.push(`${name} must be configured privately for this environment.`);
  if(Buffer.from(env.SAAS_BILLING_ENCRYPTION_KEY||'','base64').length!==32)errors.push('Automatic billing requires a separate 32-byte base64 encryption key.');
  if((env.CRON_SECRET||'').length<32)errors.push('CRON_SECRET must contain at least 32 characters.');
  try{const u=new URL(env.SAAS_WORKER_URL);if(u.origin!==new URL(env.NEXT_PUBLIC_SITE_URL).origin||u.pathname!=='/api/saas/jobs'||u.search||u.hash||u.username||u.password)throw Error();}catch{errors.push('SAAS_WORKER_URL must be the canonical /api/saas/jobs URL.');}
 }
 return errors;
}
function databaseMatchesProject(connection,ref){
 try{const u=new URL(connection);return /^postgres(?:ql)?:$/.test(u.protocol)&&/^[a-z0-9]{20}$/.test(ref)&&(u.hostname===`db.${ref}.supabase.co`||(/\.pooler\.supabase\.com$/.test(u.hostname)&&decodeURIComponent(u.username).endsWith('.'+ref)));}catch{return false;}
}
function stagingTargetProblem(connection,ref,existingConnection){
 if(!connection||!ref)return 'Hosted validation is ready to run when STAGING_DATABASE_URL and STAGING_PROJECT_REF are configured';
 if(!databaseMatchesProject(connection,ref))return 'Staging project identity does not match the database target';
 if(existingConnection&&databaseMatchesProject(existingConnection,ref))return 'Refusing to load-test the existing application Supabase project, including through another connection endpoint';
 return null;
}
module.exports={configurationProblems,databaseMatchesProject,stagingTargetProblem};
if(require.main===module){
 // Deliberately use explicit host environment, not the old flagship dotenv files.
 const errors=configurationProblems(process.env,process.argv[2]||'build');
 for(const error of errors)console.error(error);
 if(errors.length)process.exitCode=1;else console.log('SaaS target configuration passed offline checks. Hosted provider/restore acceptance remains separate.');
}
