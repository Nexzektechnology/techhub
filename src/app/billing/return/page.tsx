import {SaasPaymentReturn} from '@/components/saas-payment-return';
export const metadata={title:'Verify subscription payment',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{reference?:string}>}){
 const {reference}=await searchParams;
 if(!reference||!/^edge-saas-[0-9a-f-]{36}$/.test(reference))return <main className="platform-root platform-locked"><h1>Payment reference required.</h1><p>Open your company settings to review billing history.</p></main>;
 return <SaasPaymentReturn reference={reference}/>;
}
