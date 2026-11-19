import {test,expect} from '@playwright/test';

test('BizHub uses blue defaults and a pale blue selection on home and registration',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.bizhub-domain-card strong').last()).toHaveText('Nexzekbizhub.com');
 const action=page.getByRole('link',{name:'Set up your business →'});
 await expect(action).toHaveCSS('background-color','rgb(36, 87, 197)');
 const selection=await page.locator('h1').evaluate(el=>{
  const range=document.createRange();range.selectNodeContents(el);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);
  return getComputedStyle(el,'::selection').backgroundColor;
 });
 expect(selection).toMatch(/^color\(srgb /);
 const channels=selection.match(/[\d.]+/g)!.map(Number);expect(channels[0]).toBeGreaterThan(.7);expect(channels[2]).toBeGreaterThan(channels[1]);expect(channels[1]).toBeGreaterThan(channels[0]);
 await page.screenshot({path:'artifacts/bizhub-blue-highlight.png',fullPage:true});
 await page.goto('/start');
 await expect(page.getByRole('link',{name:'Create your account',exact:true})).toHaveCSS('background-color','rgb(36, 87, 197)');
 await expect(page.getByText('COMPANY REGISTRATION',{exact:true})).toHaveCSS('color','rgb(36, 87, 197)');
 await page.screenshot({path:'artifacts/bizhub-blue-registration.png',fullPage:true});
});

test('a company can publish its own colours without changing the BizHub platform',async({page})=>{
 await page.goto('/login');await page.getByLabel('Email address').fill('a@tenant.example');await page.getByLabel('Password',{exact:true}).fill('tenant-test-password');await page.getByRole('button',{name:/^Sign in/}).click();await expect(page).toHaveURL(/\/workspaces$/);
 await page.goto('/company/tenant-a');await page.getByRole('button',{name:'branding',exact:true}).click();
 await page.getByLabel('Primary color',{exact:true}).fill('#006758');await page.getByLabel('Accent color',{exact:true}).fill('#ddf4ee');
 const save=page.waitForResponse(r=>r.url().includes('/api/platform')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save draft',exact:true}).click();expect((await save).ok()).toBe(true);
 await expect(page.getByRole('button',{name:'Publish brand',exact:true})).toBeEnabled();page.once('dialog',d=>d.accept());
 const publish=page.waitForResponse(r=>r.url().includes('/api/platform')&&r.request().method()==='POST');await page.getByRole('button',{name:'Publish brand',exact:true}).click();expect((await publish).ok()).toBe(true);
 await page.goto('/store/tenant-a');expect(await page.locator('.tenant-store').evaluate(el=>getComputedStyle(el).getPropertyValue('--brand-primary').trim())).toBe('#006758');
 await page.goto('/');await expect(page.getByRole('link',{name:'Set up your business →'})).toHaveCSS('background-color','rgb(36, 87, 197)');
});
