import {NextResponse} from 'next/server';
import {z} from 'zod';
import {supabase} from '@/lib/server';
import {failure} from '@/lib/http';
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}){try{const {slug}=await params;const ids=z.array(z.string().min(1).max(100)).max(50).parse(new URL(req.url).searchParams.getAll('id'));const r=await(await supabase()).rpc('tenant_refresh_products',{p_slug:slug,p_ids:ids});if(r.error)throw Error('Store catalogue unavailable');return NextResponse.json(r.data,{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
