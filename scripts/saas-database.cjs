// Explicit SaaS migration profile; never silently reuse the earlier flagship target.
require('./saas-environment.cjs').loadSaasEnvironment();
require('@next/env').loadEnvConfig(process.cwd());
const {databaseMatchesProject}=require('./saas-hosting-preflight.cjs');
const {supabaseProjectRef}=require('../config/saas-deployment.json');
if(!databaseMatchesProject(process.env.DATABASE_URL,supabaseProjectRef))throw Error(`Configure DATABASE_URL privately for the designated SaaS project ${supabaseProjectRef}. No connection was made.`);
require('./database.cjs');
