import {test,expect} from "@playwright/test";
test("extension-added body attributes do not trigger a hydration mismatch",async({page})=>{
 const hydration:string[]=[];page.on("console",m=>{if(/hydrat|server rendered HTML/i.test(m.text()))hydration.push(m.text());});
 await page.addInitScript(()=>{
  const add=()=>{if(!document.body)return false;document.body.setAttribute("data-new-gr-c-s-check-loaded","14.1333.0");document.body.setAttribute("data-gr-ext-installed","");return true;};
  if(!add()){const observer=new MutationObserver(()=>{if(add())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
 });
 await page.goto("/");await expect(page.getByRole("heading",{name:"Your space starts here."})).toBeVisible();
 await expect(page.locator("body")).toHaveAttribute("data-gr-ext-installed","");await page.getByLabel("Your name",{exact:true}).fill("Ari");
 expect(hydration).toEqual([]);
});
