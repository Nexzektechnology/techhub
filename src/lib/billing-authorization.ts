import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
function key(){const value=Buffer.from(process.env.SAAS_BILLING_ENCRYPTION_KEY||'','base64');if(value.length!==32)throw Error('Automatic billing encryption is not configured');return value;}
export function automaticBillingConfigured(){try{key();return !!process.env.SAAS_PAYSTACK_SECRET_KEY;}catch{return false;}}
export function encryptAuthorization(code:string,company:string){
 if(!/^AUTH_[A-Za-z0-9]+$/.test(code)||code.length>300)throw Error('Invalid reusable authorization');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(company));
 const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptAuthorization(value:string,company:string){
 const [version,iv,tag,data,...extra]=value.split('.');if(version!=='v1'||extra.length||!iv||!tag||!data)throw Error('Invalid encrypted authorization');
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(company));decipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
}
