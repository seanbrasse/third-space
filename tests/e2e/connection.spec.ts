import {test,expect} from "@playwright/test";
test("default pines, loading states and measured offline/stalled recovery",async({page})=>{
 // The SDK tries Node-style options first, relying on a synchronous browser
 // TypeError. Playwright's route shim rejects asynchronously; preserve the
 // native fallback so the test can forward actual room frames unchanged.
 await page.addInitScript(()=>{
   const wrap=(Socket:typeof WebSocket)=>new Proxy(Socket,{construct(Target,args){
     if(args[1]&&typeof args[1]==="object"&&!Array.isArray(args[1]))throw new TypeError("Browser WebSocket protocols must be strings");
     return Reflect.construct(Target,args);
   }});
   let Socket=wrap(window.WebSocket);
   Object.defineProperty(window,"WebSocket",{configurable:true,get:()=>Socket,set:(value:typeof WebSocket)=>{Socket=wrap(value);}});
 });
 let stall=false;
 await page.routeWebSocket(/:2577/,ws=>{
  const server=ws.connectToServer();
  server.onMessage(message=>{if(!stall)ws.send(message);});
  ws.onMessage(message=>server.send(message));
 });
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/homes",async route=>{if(route.request().method()==="POST")await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
 await page.goto("/");
 await page.getByLabel("Your name",{exact:true}).fill("Ari");
 await page.getByLabel("Home name",{exact:true}).fill("Connection "+Date.now());
 await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");
 await page.getByRole("button",{name:"Create & enter home"}).click();
 await expect(page.getByRole("button",{name:/Opening the door/}).locator(".loading-spinner")).toBeVisible();
 await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","forest");
 await expect(page.locator(".world-busy")).toHaveCount(0);
 await expect(page.locator(".network-health")).toHaveAttribute("data-quality","good");
 await expect(page.locator(".network-health")).toContainText(/\d+ ms/);
 await page.screenshot({path:"tests/e2e/artifacts/connection-healthy.png",fullPage:true});
 stall=true;
 await expect(page.locator(".network-health")).toHaveAttribute("data-quality","stalled",{timeout:6000});
 stall=false;
 await expect(page.locator(".network-health")).toHaveAttribute("data-quality","good",{timeout:7000});
 await page.context().setOffline(true);
 await expect(page.locator(".network-health")).toHaveAttribute("data-quality","offline");
 await page.context().setOffline(false);
 await expect(page.locator(".network-health")).toHaveAttribute("data-quality","good",{timeout:10000});
 await page.getByRole("button",{name:"☷ Worlds"}).click();
 await page.getByRole("button",{name:/The reading lounge/}).click();
 await expect(page.getByText(/Everyone moves together in/)).toBeVisible();
 await page.getByRole("button",{name:"Close worlds"}).click();
 await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","living-room",{timeout:12000});
 await expect(page.locator(".world-busy")).toHaveCount(0);
 await page.getByRole("button",{name:"☷ Worlds"}).click();
 await page.getByRole("button",{name:/Midnight Pines/}).click();
 await expect(page.getByText(/Everyone moves together in/)).toBeVisible();
 await page.getByRole("button",{name:"Close worlds"}).click();
 await expect(page.locator(".world-canvas")).toHaveAttribute("data-world-id","forest",{timeout:12000});
 expect(errors).toEqual([]);
});
