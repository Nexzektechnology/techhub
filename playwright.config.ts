import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:3100',channel:process.env.CI?undefined:'chrome',headless:true,trace:'retain-on-failure'},reporter:'list',
  webServer:{command:'npm run dev -- --port 3100',url:'http://127.0.0.1:3100',reuseExistingServer:false,timeout:120000,env:{
    SAAS_PAYSTACK_SECRET_KEY:'',SAAS_DOMAIN_ROUTING:'false',SAAS_TRUSTED_APP_HOSTS:'',E2E_OFFLINE:'true',
    NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3100',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',PAYSTACK_SECRET_KEY:'',CRON_SECRET:'',LOCAL_DEMO:'true',LOCAL_DATABASE_PATH:`.data/e2e-${process.pid}-${Date.now()}.sqlite`,NEXT_DIST_DIR:'.next-e2e',
  }},
});
