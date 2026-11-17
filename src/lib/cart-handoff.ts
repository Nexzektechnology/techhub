import {z} from 'zod';
export const handoffCart=z.array(z.object({id:z.string().min(1).max(100),quantity:z.number().int().min(1).max(50),options:z.record(z.string().min(1).max(60),z.string().min(1).max(80)).refine(v=>Object.keys(v).length<=20)}).strict()).min(1).max(50);
export function handoffUrl(origin:string,slug:string,lines:z.infer<typeof handoffCart>){
 const base=new URL(origin);if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||!(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))throw Error('Secure checkout address unavailable');
 const data=JSON.stringify(handoffCart.parse(lines));if(data.length>16000)throw Error('Your bag is too large to transfer');return `${base.origin}/store/${slug}/continue#bag=${encodeURIComponent(data)}`;
}
