import { homepageCatalogue, publishedTheme, records } from '@/lib/server';
import {liveDealPlacements} from '@/lib/live-deals';
import {homepageProductAllowed} from '@/lib/homepage-products';
import { Storefront } from '@/components/storefront';
import {BizhubHome} from '@/components/bizhub-home';
import ShopLayout from '@/components/shop-layout';
export default function Home(){return process.env.SAAS_PLATFORM_SITE==='true'?<BizhubHome/>:<ShopLayout><LegacyHome/></ShopLayout>;}
async function LegacyHome(){const [data,theme,banners,merchants,deals]=await Promise.all([homepageCatalogue(),publishedTheme(),records('banners',true),records('merchants',true),liveDealPlacements()]);return <Storefront theme={theme} {...data} banners={banners} merchants={merchants} deals={deals.map(d=>({...d,products:d.products.filter(homepageProductAllowed)}))}/>;}
