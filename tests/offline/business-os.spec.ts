import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
async function login(page:Page,who:string){await page.goto('/login');await page.getByLabel('Email address').fill(`${who}@tenant.example`);await page.getByLabel('Password',{exact:true}).fill('tenant-test-password');await page.getByRole('button',{name:/^Sign in/}).click();await expect(page).toHaveURL(/\/workspaces$/);}
test.beforeEach(async({context})=>{await context.route('https://**/*',route=>route.abort());});

test('business owner maintains customer, supplier and product records, and traces a stock adjustment',async({page})=>{
 await login(page,'a');await page.goto('/company/tenant-a/business');
 await expect(page.getByRole('heading',{name:'A clearer view of your operation.'})).toBeVisible();
 await expect(page.locator('.bos-root')).toHaveCSS('display','flex');
 await expect(page.getByRole('button',{name:'Collapse navigation'})).toBeEnabled();
 await page.keyboard.press('/');await expect(page.getByRole('textbox',{name:'Search records'})).toBeFocused();await page.keyboard.press('Tab');
 await page.screenshot({path:'artifacts/business-os-overview-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Customers',exact:true}).click();await page.getByRole('button',{name:'Add customer',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('Foundation customer');await page.getByLabel('Email',{exact:true}).fill('foundation@example.com');await page.getByLabel('Phone',{exact:true}).fill('08012345678');await page.getByLabel('Address',{exact:true}).fill('15 Lagos Street');await page.getByLabel('Notes',{exact:true}).fill('Prefers collection in store');
 await page.getByRole('button',{name:'Save details'}).click();await expect(page.getByRole('row').filter({hasText:'Foundation customer'})).toBeVisible();
 await page.getByRole('button',{name:'Edit Foundation customer'}).click();await page.getByLabel('Name',{exact:true}).fill('Updated foundation customer');await page.getByRole('button',{name:'Save details'}).click();await expect(page.getByRole('row').filter({hasText:'Updated foundation customer'})).toBeVisible();
 await page.getByRole('link',{name:'Suppliers',exact:true}).click();await page.getByRole('button',{name:'Add supplier',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Foundation supplier');await page.getByRole('button',{name:'Save details'}).click();await expect(page.getByRole('row').filter({hasText:'Foundation supplier'})).toBeVisible();
 await page.getByRole('link',{name:'Product master',exact:true}).click();await page.getByRole('button',{name:'Edit A Rice',exact:true}).click();await page.getByLabel('SKU',{exact:true}).fill('RICE-FOUNDATION');await page.getByLabel('Recorded unit cost (NGN)').fill('60');await page.getByLabel('Reorder point (units per warehouse)').fill('5');await page.getByLabel('Supplier',{exact:true}).selectOption({label:'Foundation supplier'});await page.getByRole('button',{name:'Save product master'}).click();await expect(page.getByRole('row').filter({hasText:'RICE-FOUNDATION'}).getByText('₦60',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Stock availability',exact:true}).click();await page.getByRole('button',{name:'Adjust A Rice at A Main Warehouse',exact:true}).click();await page.getByLabel('Quantity change').fill('3');await page.getByLabel('Reason',{exact:true}).fill('Verified browser acceptance adjustment');await page.getByRole('button',{name:'Record adjustment',exact:true}).click();await expect(page.getByRole('status')).toContainText('Stock movement recorded');
 await page.getByRole('link',{name:'Movement history',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'Verified browser acceptance adjustment'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/business-os-history-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Collapse navigation'}).click();await expect(page.getByRole('button',{name:'Expand navigation'})).toBeVisible();await page.getByRole('button',{name:'Expand navigation'}).click();
});

test('storekeeper sees assigned stock without customer, supplier or cost data, and retries one stock command',async({page})=>{
 const f=JSON.parse(readFileSync(`${process.env.E2E_FIXTURE_ROOT||'.data/offline'}/tenant-fixture.json`,'utf8'));await login(page,'staff');await page.goto('/company/tenant-a/business');
 await expect(page.getByRole('link',{name:'Customers',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Suppliers',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Product master',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Stock availability',exact:true}).click();await expect(page.getByText('A Restricted Warehouse',{exact:true})).toHaveCount(0);
 const payload={key:crypto.randomUUID(),action:'stock',data:{warehouse_id:f.locations.a.warehouse,product_id:f.products.a,delta:1,reason:'Offline retry acceptance'}};
 const first=await page.request.post('/api/tenant/tenant-a/business',{headers:{origin:f.app},data:payload}),second=await page.request.post('/api/tenant/tenant-a/business',{headers:{origin:f.app},data:payload});expect(first.status()).toBe(200);expect(await second.json()).toEqual(await first.json());
 const denied=await page.request.post('/api/tenant/tenant-a/business',{headers:{origin:f.app},data:{...payload,key:crypto.randomUUID(),data:{...payload.data,warehouse_id:f.locations.private.warehouse}}});expect(denied.status()).toBe(403);
 const data=await(await page.request.get('/api/tenant/tenant-a/business')).json();expect(data.products).toEqual([]);expect(data.customers).toEqual([]);
 await page.getByRole('link',{name:'Movement history',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'Offline retry acceptance'})).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'A clearer view of your operation.'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/business-os-overview-mobile.png',fullPage:true});
});
