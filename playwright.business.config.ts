import {defineConfig} from '@playwright/test';
import base from './playwright.tenant.config';
const origin='http://127.0.0.1:3210',service='http://127.0.0.1:54339',fixtureRoot='.data/business-offline';
process.env.E2E_FIXTURE_ROOT=fixtureRoot;
process.env.E2E_APP_ORIGIN=origin;
const original=Array.isArray(base.webServer)?base.webServer[1]:undefined;
// Cold webpack route compilation on the local Windows runner can exceed 15s.
// Keep assertions intact while allowing the server to finish the first request.
export default defineConfig({...base,timeout:180000,expect:{timeout:30000},use:{...base.use,baseURL:origin},webServer:[
 {command:'node tests/offline/tenant-services.cjs',url:service+'/health',reuseExistingServer:false,timeout:120000,env:{E2E_FIXTURE_ROOT:fixtureRoot,E2E_SERVICE_PORT:'54339',E2E_APP_ORIGIN:origin}},
 {command:'npm run dev -- --webpack --port 3210',url:origin+'/start',reuseExistingServer:false,timeout:120000,env:{...original?.env,NEXT_PUBLIC_SITE_URL:origin,NEXT_PUBLIC_SUPABASE_URL:service,PAYSTACK_TEST_API_ORIGIN:service,NEXT_DIST_DIR:'.data/next-business-e2e',E2E_FIXTURE_ROOT:fixtureRoot,E2E_APP_ORIGIN:origin}},
]});
