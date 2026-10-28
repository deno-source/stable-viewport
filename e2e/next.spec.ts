import {test,expect,active,measure} from './fixtures';
test('Next.js SSR, hydration, native 500%, refresh and client navigation',async({lab,zoom})=>{
  const errors:string[]=[];lab.on('pageerror',e=>errors.push(e.message));
  await lab.goto('http://localhost:4380');await active(lab);const before=await measure(lab,'#ssr-px');
  await zoom(5);expect(Math.abs((await measure(lab,'#ssr-px')).width-before.width)).toBeLessThan(1);
  await lab.reload();await active(lab);expect((await measure(lab,'#ssr-px')).width).toBeCloseTo(120,0);
  await lab.getByRole('link',{name:'Client navigation'}).click();await expect(lab.locator('#ssr-svg')).toBeVisible();
  expect((await measure(lab,'#ssr-svg')).width).toBeCloseTo(24,0);expect(errors).toEqual([]);
});
test('Next.js client fallback works if the bootstrap asset fails',async({lab,zoom})=>{
  await lab.route('**/stable-viewport.auto.js',route=>route.abort());
  await lab.goto('http://localhost:4380');await active(lab);await zoom(5);
  expect((await measure(lab,'#ssr-px')).width).toBeCloseTo(120,0);
});
