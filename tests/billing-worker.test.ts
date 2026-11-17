import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),provider:vi.fn(),configured:vi.fn(),decrypt:vi.fn()}));
vi.mock('../src/lib/server',()=>({service:()=>({rpc:mocks.rpc})}));
vi.mock('../src/lib/saas-server',()=>({saasPaystack:mocks.provider,verifiedSaasCharge:(c:Record<string,unknown>)=>({p_reference:c.reference})}));
vi.mock('../src/lib/billing-authorization',()=>({automaticBillingConfigured:mocks.configured,decryptAuthorization:mocks.decrypt}));
import {runBillingWorker} from '../src/lib/billing-worker';
import {POST as scheduledJob} from '../src/app/api/saas/jobs/route';
const job={id:'job',lease:'lease',company_id:'company',reference:'reference',amount:100,currency:'NGN',submit:true,email:'payer@example.invalid',ciphertext:'encrypted',created_at:new Date().toISOString()};
beforeEach(()=>{vi.resetAllMocks();mocks.configured.mockReturnValue(true);mocks.decrypt.mockReturnValue('AUTH_fixture');mocks.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='saas_claim_charge_jobs'?[job]:0}));mocks.provider.mockImplementation(async(path:string)=>path.startsWith('/transaction/verify/')?{reference:'reference',amount:100,currency:'NGN',status:'success'}:{});});
afterEach(()=>vi.unstubAllEnvs());
it('submits a claimed authorization once and applies only independently verified payment',async()=>{
 expect(await runBillingWorker()).toMatchObject({processed:1,outcomes:[{outcome:'paid'}]});
 expect(mocks.provider.mock.calls.map(c=>c[0])).toEqual(['/transaction/charge_authorization','/transaction/verify/reference']);
 expect(mocks.rpc).toHaveBeenCalledWith('saas_apply_payment',{p_reference:'reference'});
 expect(mocks.rpc).toHaveBeenCalledWith('saas_finish_charge_job',expect.objectContaining({p_outcome:'paid'}));
});
it('never submits an authorization on a recovery lease and rejects mismatched verification',async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='saas_claim_charge_jobs'?[{...job,submit:false}]:0}));mocks.provider.mockResolvedValue({reference:'other',amount:100,currency:'NGN',status:'success'});
 await runBillingWorker();expect(mocks.provider).toHaveBeenCalledTimes(1);expect(mocks.provider).toHaveBeenCalledWith('/transaction/verify/reference');expect(mocks.decrypt).not.toHaveBeenCalled();
 expect(mocks.rpc.mock.calls.some(c=>c[0]==='saas_apply_payment')).toBe(false);expect(mocks.rpc).toHaveBeenCalledWith('saas_finish_charge_job',expect.objectContaining({p_outcome:'pending'}));
});
it('routes long-pending provider responses to reconciliation instead of polling forever',async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='saas_claim_charge_jobs'?[{...job,submit:false,created_at:new Date(Date.now()-90000000).toISOString()}]:0}));mocks.provider.mockResolvedValue({reference:'reference',amount:100,currency:'NGN',status:'pending'});
 await runBillingWorker();expect(mocks.rpc).toHaveBeenCalledWith('saas_finish_charge_job',expect.objectContaining({p_outcome:'review'}));
});
it('keeps reservation expiry operational while automatic charging configuration is absent',async()=>{
 mocks.configured.mockReturnValue(false);expect(await runBillingWorker()).toMatchObject({processed:0,automatic_billing_paused:true});expect(mocks.rpc).toHaveBeenCalledWith('tenant_expire_pending');expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls.some(c=>c[0]==='saas_enqueue_renewals')).toBe(false);
});
it('rejects malformed or non-ASCII scheduler credentials without throwing or running work',async()=>{
 const secret='offline-scheduler-secret-at-least-32-characters';vi.stubEnv('CRON_SECRET',secret);
 const request=(authorization:string)=>new Request('https://example.com/api/saas/jobs',{method:'POST',headers:{authorization}});
 for(const header of ['',`Bearer ${secret.slice(0,-1)}é`,'Bearer wrong'])expect((await scheduledJob(request(header))).status).toBe(401);
 expect(mocks.rpc).not.toHaveBeenCalled();expect((await scheduledJob(request(`Bearer ${secret}`))).status).toBe(200);
});
