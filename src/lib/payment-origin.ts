import 'server-only';
export function paymentOrigin(secret:string){
 const fixture=process.env.PAYSTACK_TEST_API_ORIGIN;if(!fixture||process.env.NODE_ENV==='production')return 'https://api.paystack.co';
 const url=new URL(fixture);if(!secret.startsWith('sk_test_')||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid offline payment fixture');return url.origin;
}
