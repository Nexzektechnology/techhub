export class RequestBodyTooLarge extends Error {
 constructor(){super('Request too large');}
}

export async function boundedText(req:Request,limit:number):Promise<string>{
 if(Number(req.headers.get('content-length'))>limit)throw new RequestBodyTooLarge();
 const reader=req.body?.getReader();if(!reader)throw Error('Request body required');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new RequestBodyTooLarge();}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
