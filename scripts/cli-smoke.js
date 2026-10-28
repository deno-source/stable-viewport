async page=>{
 await page.goto('http://127.0.0.1:4379/examples/playground/?manual');
 await page.waitForFunction(()=>!!window.fixture);
 const before=await page.evaluate(()=>({media:window.matchMedia.name,inline:document.querySelector('#inline').getAttribute('style')}));
 await page.locator('#mount').click();await page.locator('#unmount').click();
 const after=await page.evaluate(()=>({media:window.matchMedia.name,inline:document.querySelector('#inline').getAttribute('style'),width:document.querySelector('#inline').style.width,height:document.querySelector('#inline').style.height}));
 return {before,after};
}
