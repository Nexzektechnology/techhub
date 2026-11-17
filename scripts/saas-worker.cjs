// Run once from the host's scheduler every five minutes. Secrets stay in private environment configuration.
require('@next/env').loadEnvConfig(process.cwd());
async function main(){
 const endpoint=process.env.SAAS_WORKER_URL,secret=process.env.CRON_SECRET||'';if(!endpoint||secret.length<32)throw Error('Set SAAS_WORKER_URL and a private CRON_SECRET of at least 32 characters');
 const url=new URL(endpoint);if(url.username||url.password||url.search||url.hash||url.pathname!=='/api/saas/jobs'||(url.protocol!=='https:'&&!(process.argv.includes('--offline')&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw Error('Use the HTTPS jobs endpoint; loopback HTTP is allowed only with --offline');
 const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Worker returned HTTP ${response.status}`);const result=await response.json();console.log(JSON.stringify({processed:result.processed,automatic_billing_paused:result.automatic_billing_paused===true}));
}
main().catch(e=>{console.error('Scheduled worker failed: '+e.message);process.exitCode=1;});
