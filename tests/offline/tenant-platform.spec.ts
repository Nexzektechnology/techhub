import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=()=>JSON.parse(readFileSync('.data/offline/tenant-fixture.json','utf8'));
async function login(page:Page,who:string){await page.goto('/login');await page.getByLabel('Email address').fill(`${who}@tenant.example`);await page.getByLabel('Password',{exact:true}).fill('tenant-test-password');await page.getByRole('button',{name:/^Sign in/}).click();await expect(page).toHaveURL(who==='customer'?/\/account$/:/\/workspaces$/);}
test.beforeEach(async({context})=>{await context.route('https://**/*',route=>new URL(route.request().url()).hostname==='checkout.paystack.com'?route.fulfill({contentType:'text/html',body:'<h1>Offline payment provider</h1>'}):route.abort());});

test('assigned subdomains and verified customer domains keep the storefront address and transfer bags to central checkout',async({page,context})=>{
 // Simulate HTTPS and DNS locally while exercising the real host resolver and proxy.
 const browserErrors:string[]=[];page.on('pageerror',error=>browserErrors.push(error.message));
 // Next's development bootstrap also needs its actual HMR WebSocket; HTTP interception alone cannot resolve fixture DNS.
 await context.routeWebSocket(/^wss?:\/\/(?:[a-z.-]+\.nexzekbizhub\.test|wenlas\.example\.test)\/_next\/hmr/,socket=>{
  const target=new URL(socket.url());target.protocol='ws:';target.host='127.0.0.1:3200';const upstream=new WebSocket(target);upstream.binaryType='arraybuffer';
  const pending:(string|Buffer)[]=[];
  socket.onMessage(message=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(message);else pending.push(message);});
  upstream.addEventListener('open',()=>{for(const message of pending)upstream.send(message);pending.length=0;});
  upstream.addEventListener('message',event=>socket.send(typeof event.data==='string'?event.data:Buffer.from(event.data)));
  upstream.addEventListener('error',()=>socket.close());
  socket.onClose(()=>{if(upstream.readyState===WebSocket.OPEN)upstream.close();});
 });
 await context.route(/^https:\/\/(?:[a-z.-]+\.nexzekbizhub\.test|wenlas\.example\.test)(?:\/|$)/,async route=>{
  const original=new URL(route.request().url()),local=new URL(original.pathname+original.search,'http://127.0.0.1:3200');
  const response=await route.fetch({url:local.toString(),headers:{...route.request().headers(),host:original.host},maxRedirects:0});
  await route.fulfill({response});
 });
 await login(page,'customer');
 await page.goto('https://tenant-a.nexzekbizhub.test/');await expect(page.getByRole('heading',{name:'tenant-a',exact:true})).toBeVisible();await expect(page).toHaveURL('https://tenant-a.nexzekbizhub.test/');
 await expect(page.getByRole('complementary',{name:'Signed-in account controls'})).toHaveCount(0);
 await page.getByRole('heading',{name:'A Rice',exact:true}).getByRole('link').click();await expect(page).toHaveURL('https://tenant-a.nexzekbizhub.test/products/rice');
 await page.getByRole('button',{name:'Add to bag',exact:true}).click();await page.getByRole('link',{name:'Bag · 1'}).click();
 await page.getByRole('button',{name:'Continue to secure checkout',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:3200/store/tenant-a/checkout');
 await expect(page.getByLabel('Full name')).toBeVisible();await expect(page.getByText('1 × A Rice',{exact:true})).toBeVisible();
 await page.goto('https://wenlas.example.test/');await expect(page.getByRole('heading',{name:'tenant-a',exact:true})).toBeVisible();await expect(page).toHaveURL('https://wenlas.example.test/');
 for(const address of ['https://tenant-a.nexzekbizhub.test/store/tenant-b','https://unknown.nexzekbizhub.test/','https://wenlas.example.test/api/saas']){
  const response=await page.goto(address);expect(response?.status()).toBe(421);await expect(page.getByText('Domain unavailable',{exact:true})).toBeVisible();
 }
 expect(browserErrors).toEqual([]);
});

test('BizHub home and the business manual remain usable on mobile screens',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'Run your business under your own name.'})).toBeVisible();await expect(page.getByRole('banner')).toHaveCount(1);await expect(page.getByRole('link',{name:/E-Edge.*home/})).toHaveCount(0);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/bizhub-home-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'User guide',exact:true}).click();await expect(page.getByRole('heading',{name:'Nexzek BizHub user manual',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Manual chapters'}).getByRole('link')).toHaveCount(11);await expect(page.getByRole('heading',{name:'8. Connect a domain such as wenlas.com',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/bizhub-manual-mobile.png',fullPage:true});await expect(page.getByRole('heading',{name:'11. Work offline and synchronize',exact:true})).toBeVisible();await page.goto('/apps');await expect(page.getByRole('link',{name:'Download Android APK'})).toHaveAttribute('href','https://github.com/Nexzektechnology/techhub/releases/download/bizhub-v1.0.0/Nexzek-BizHub.apk');await expect(page.getByRole('link',{name:'Download Windows app'})).toHaveAttribute('href','https://github.com/Nexzektechnology/techhub/releases/download/bizhub-v1.0.0/Nexzek.BizHub.exe');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/bizhub-apps-mobile.png',fullPage:true});
});
test('separate stores and browser bags remain isolated on the actual application',async({page})=>{
 await page.goto('/store/tenant-a');await expect(page.getByRole('heading',{name:'tenant-a',exact:true})).toBeVisible();await page.getByRole('heading',{name:'A Rice',exact:true}).getByRole('link').click();await expect(page.getByRole('heading',{name:'A Rice',exact:true})).toBeVisible();await page.getByRole('button',{name:'Add to bag',exact:true}).click();await expect(page.getByRole('link',{name:'Bag · 1'})).toBeVisible();
 await page.goto('/store/tenant-b/cart');await expect(page.getByRole('heading',{name:'A bag full of possibilities.'})).toBeVisible();await page.goto('/store/tenant-a/cart');await expect(page.getByRole('heading',{name:'A Rice',exact:true})).toBeVisible();await page.goto('/cart');await expect(page.getByRole('heading',{name:'A bag full of possibilities.'})).toBeVisible();
});
test('warehouse staff cannot read or mutate an unassigned branch through UI or direct API',async({page})=>{
 const f=fixture();await login(page,'staff');await page.goto('/company/tenant-a/commerce');await expect(page.getByRole('heading',{name:'Your operation, in focus.'})).toBeVisible();await page.getByRole('button',{name:'inventory',exact:true}).click();await expect(page.getByRole('cell',{name:'A Main Warehouse',exact:true})).toBeVisible();await expect(page.getByText('A Restricted Warehouse',{exact:true})).toHaveCount(0);
 const denied=await page.request.post('/api/tenant/tenant-a/commerce',{headers:{origin:f.app},data:{action:'stock',data:{warehouse_id:f.locations.private.warehouse,product_id:f.products.a,delta:1,reason:'Direct unauthorized stock attack'}}});expect(denied.status()).toBe(403);
 const companyB=await page.request.post('/api/tenant/tenant-b/commerce',{headers:{origin:f.app},data:{action:'stock',data:{warehouse_id:f.locations.b.warehouse,product_id:f.products.b,delta:1,reason:'Cross company direct API attack'}}});expect(companyB.status()).toBe(403);
});
test('checkout, signed webhook verification and payment replay complete entirely offline',async({page})=>{
 const f=fixture();await login(page,'customer');await page.goto('/store/tenant-a/products/rice');await page.getByRole('button',{name:'Add to bag',exact:true}).click();await page.goto('/store/tenant-a/checkout');await page.getByLabel('Full name').fill('Offline Customer');await page.getByLabel('Phone number').fill('08012345678');await page.getByLabel('Street address').fill('123 Offline Customer Street');await page.getByLabel('City',{exact:true}).fill('Lagos');await page.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect(page).toHaveURL(/https:\/\/checkout.paystack.com\/edge-tenant-/);
 const reference=page.url().split('/').at(-1)!;const completed=await page.request.post(f.origin+'/__fixture',{headers:{'x-fixture-control':f.control},data:{action:'complete',reference}});expect(await completed.json()).toMatchObject({webhookStatus:200});await page.goto(`/store/tenant-a/confirmation?reference=${reference}`);await expect(page.getByRole('heading',{name:'Payment confirmed.'})).toBeVisible();
 const replay=await page.request.post(f.origin+'/__fixture',{headers:{'x-fixture-control':f.control},data:{action:'complete',reference}});expect(await replay.json()).toMatchObject({webhookStatus:200});
});
test('explicit automatic renewal consent produces one due charge and can be cancelled',async({page})=>{
 const f=fixture();await login(page,'a');await page.goto('/company/tenant-a/settings');await page.getByLabel('Plan and billing cycle').selectOption(f.price);await page.getByLabel('I authorize automatic renewal',{exact:false}).check();await page.getByRole('button',{name:'Continue to Paystack'}).click();await expect(page).toHaveURL(/https:\/\/checkout.paystack.com\/edge-saas-/);const reference=page.url().split('/').at(-1)!;
 const completed=await page.request.post(f.origin+'/__fixture',{headers:{'x-fixture-control':f.control},data:{action:'complete',reference}});expect(await completed.json()).toMatchObject({webhookStatus:200});await page.goto('/company/tenant-a/settings');await expect(page.getByRole('button',{name:'Turn off automatic renewal'})).toBeVisible();
 await page.request.post(f.origin+'/__fixture',{headers:{'x-fixture-control':f.control},data:{action:'due',company_id:f.companies.a}});const run=await page.request.post('/api/saas/jobs',{headers:{authorization:'Bearer offline-cron-token-at-least-32-characters'}});expect(run.ok()).toBe(true);expect(await run.json()).toMatchObject({processed:1});const again=await page.request.post('/api/saas/jobs',{headers:{authorization:'Bearer offline-cron-token-at-least-32-characters'}});expect(await again.json()).toMatchObject({processed:0});
 await page.reload();await page.getByRole('button',{name:'Turn off automatic renewal'}).click();await expect(page.getByText('Automatic renewal is off.',{exact:false})).toBeVisible();
});
test('an owner creates and edits an optioned product, receives stock and opens a mobile storefront',async({page})=>{
 await login(page,'a');await page.goto('/company/tenant-a/commerce');
 const category=page.locator('section').filter({has:page.getByRole('heading',{name:'Add a category',exact:true})});await category.getByLabel('Category name').fill('Offline cosmetics');await category.getByRole('button',{name:'Create category'}).click();
 const product=page.locator('section').filter({has:page.getByRole('heading',{name:'Add a product',exact:true})});await expect(product.getByRole('combobox',{name:'Category',exact:true}).locator('option').filter({hasText:'Offline cosmetics'})).toHaveCount(1);
 await product.getByLabel('Name',{exact:true}).fill('Offline lotion');await product.getByLabel('Product URL slug').fill('offline-lotion');await product.getByRole('combobox',{name:'Category',exact:true}).selectOption({label:'Offline cosmetics'});await product.getByLabel('Price (NGN)').fill('2000');await product.getByLabel('Image URL').fill('/window.svg');await product.getByLabel('Description').fill('Synthetic product for offline acceptance.');await product.getByRole('button',{name:'Add option',exact:true}).click();await product.getByLabel('Option name',{exact:true}).fill('Size');await product.getByLabel('Option values').fill('Small, Large');await product.getByLabel('Publish product').check();await product.getByRole('button',{name:'Save product'}).click();
 const row=page.getByRole('row').filter({hasText:'Offline lotion'});await expect(row).toBeVisible();await row.getByRole('button',{name:'Edit product'}).click();const editing=page.locator('section').filter({has:page.getByRole('heading',{name:'Edit product',exact:true})});await editing.getByLabel('Product URL slug').fill('offline-lotion-updated');await editing.getByLabel('Price (NGN)').fill('2200');await editing.getByRole('button',{name:'Save product'}).click();await expect(row).toContainText('2,200');
 await page.getByRole('button',{name:'inventory',exact:true}).click();const stock=page.locator('section').filter({has:page.getByRole('heading',{name:'Receive or adjust stock',exact:true})});await stock.getByRole('combobox',{name:'Warehouse',exact:true}).selectOption({label:'A Main Warehouse'});await stock.getByRole('combobox',{name:'Product',exact:true}).selectOption({label:'Offline lotion'});await stock.getByLabel('Quantity change').fill('4');await stock.getByLabel('Reason').fill('Synthetic receipt for browser acceptance');await stock.getByRole('button',{name:'Record adjustment'}).click();await expect(page.getByRole('row').filter({hasText:'Offline lotion'})).toContainText('4');
 await page.goto('/store/tenant-a/products/offline-lotion-updated');await expect(page.getByRole('heading',{name:'Offline lotion',exact:true})).toBeVisible();await page.getByRole('button',{name:'Small',exact:true}).click();await page.getByRole('button',{name:'Add to bag',exact:true}).click();await expect(page.getByRole('link',{name:'Bag · 1'})).toBeVisible();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/tenant-store-mobile.png',fullPage:true});
});
