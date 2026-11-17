import {test,expect} from '@playwright/test';
test('SaaS entrypoints require verified identity and keep legacy account flows available',async({page,request})=>{
 await page.goto('/start');await expect(page.getByRole('heading',{name:'Start with a verified account.'})).toBeVisible();
 await page.getByRole('link',{name:'Create your account'}).click();await expect(page).toHaveURL(/\/register\?next=\/start$/);
 await page.route('**/api/auth',async route=>{expect(route.request().postDataJSON()).toMatchObject({action:'register',next:'/start'});await route.fulfill({json:{ok:true,confirmation:true}});});
 await page.getByLabel('Email address').fill('owner@example.com');await page.getByLabel('Password',{exact:true}).fill('test-company-password');await page.getByRole('button',{name:'Create account'}).click();await expect(page.getByRole('status')).toContainText('Check your email');
 await page.goto('/company/acme/settings');await expect(page.getByRole('heading',{name:'Company administrator access required.'})).toBeVisible();
 await page.goto('/platform/billing');await expect(page.getByRole('heading',{name:'Platform owner access required.'})).toBeVisible();
 const denied=await request.post('/api/saas',{headers:{origin:'http://127.0.0.1:3100'},data:{action:'cancel',company_id:'30000000-0000-4000-8000-000000000001',cancel:true}});expect(denied.ok()).toBe(false);
 const start=await request.get('/start');expect(start.headers()['cache-control']).toContain('no-store');
 await page.goto('/products');await expect(page.getByRole('heading',{name:'Shop the collection.'})).toBeVisible();
});
