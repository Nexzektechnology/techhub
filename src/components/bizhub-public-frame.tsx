import Link from 'next/link';
import type {ReactNode} from 'react';
export function BizhubPublicFrame({children}:{children:ReactNode}){
 return <div className="bizhub-page"><header className="bizhub-nav"><Link className="bizhub-wordmark" href="/"><span>N</span>Nexzek <b>BizHub</b></Link><nav><Link href="/manual">User guide</Link><Link href="/workspaces">My workspaces</Link></nav></header><main id="main-content">{children}</main><footer className="bizhub-footer"><span>Nexzek BizHub</span><Link href="/manual">Help &amp; user manual</Link></footer></div>;
}
