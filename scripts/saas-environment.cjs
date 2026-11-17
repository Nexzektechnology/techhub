const fs=require('node:fs'),{parseEnv}=require('node:util');
function loadSaasEnvironment(){
 const file='.env.saas.local';if(!fs.existsSync(file))return false;
 const parsed=parseEnv(fs.readFileSync(file,'utf8'));
 const names=['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','DATABASE_CA_PATH','SAAS_MIGRATION_EVIDENCE','PAYSTACK_SECRET_KEY','SAAS_PAYSTACK_SECRET_KEY','SAAS_BILLING_ENCRYPTION_KEY','CRON_SECRET','SAAS_WORKER_URL','SAAS_DOMAIN_ROUTING','SAAS_TENANT_ROOT_DOMAIN','SAAS_TRUSTED_APP_HOSTS','SAAS_PLATFORM_SITE','SAAS_SETUP_MODE','LOCAL_DEMO'];
 for(const name of names)if(Object.hasOwn(parsed,name))process.env[name]=parsed[name];
 // A dedicated new-project profile must never inherit old project credentials.
 for(const name of ['NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PAYSTACK_SECRET_KEY','SAAS_PAYSTACK_SECRET_KEY'])if(!Object.hasOwn(parsed,name))process.env[name]='';
 if(!parsed.NEXT_PUBLIC_SUPABASE_URL)process.env.NEXT_PUBLIC_SUPABASE_URL='https://'+require('../config/saas-deployment.json').supabaseProjectRef+'.supabase.co';
 return true;
}
module.exports={loadSaasEnvironment};
