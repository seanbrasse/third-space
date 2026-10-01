import { gameAction } from "./menu-actions";
import { test, expect, type Page } from "@playwright/test";

// Deterministic gesture-policy adapter, not a real iOS/provider verification.
const fixture = `
window.__gesture=false;window.__ytEvents=[];
document.addEventListener('click',()=>{window.__gesture=true;setTimeout(()=>window.__gesture=false,0)},true);
window.YT={Player:class{
 constructor(el,o){window.__ytEvents.push({kind:"create",at:Date.now()});this.events=o.events;this.t=0;this.s=2;this.at=Date.now();this.el=document.createElement('iframe');this.el.title='Mobile watching fixture';el.replaceWith(this.el);window.__yt=this;setTimeout(()=>o.events.onReady(),0)}
 getCurrentTime(){return this.t+(this.s===1?(Date.now()-this.at)/1000:0)} getDuration(){return 300} getPlayerState(){return this.s}
 playVideo(){window.__ytEvents.push({kind:"play",gesture:window.__gesture,at:Date.now(),s:this.s,t:this.t});if(!window.__gesture){this.events.onAutoplayBlocked();return}this.t=this.getCurrentTime();this.at=Date.now();this.s=1;this.events.onStateChange({data:1})}
 pauseVideo(){window.__ytEvents.push({kind:"pause",at:Date.now(),s:this.s,t:this.t});this.t=this.getCurrentTime();this.s=2;this.events.onStateChange({data:2})}
 seekTo(t){window.__ytEvents.push({kind:"seek",at:Date.now(),target:t,s:this.s});this.t=t;this.at=Date.now()} setVolume(){} destroy(){this.el.remove();window.__yt=null}
}};window.onYouTubeIframeAPIReady?.();`;

async function enterIndoor(page: Page) {
  const world = page.locator(".world-canvas");
  await expect(world).toHaveAttribute("data-authoritative-x", /[0-9]/);
  for (const point of [{x:24,y:28},{x:27,y:28},{x:27,y:24},...Array.from({length:6},(_,i)=>({x:34+i*7,y:24})),{x:69,y:17},{x:69,y:13.5}]) {
    if (await world.getAttribute("data-world-id") === "asylum") break;
    const hit = await world.evaluate((el, p) => {
      const d=(el as HTMLElement).dataset,b=el.querySelector("canvas")!.getBoundingClientRect();
      return {x:b.x+(p.x*32-Number(d.cameraScrollX))*Number(d.cameraZoom),y:b.y+(p.y*32-Number(d.cameraScrollY))*Number(d.cameraZoom)};
    },point);
    await page.mouse.click(hit.x,hit.y);
    await expect.poll(async()=>{
      const d=await world.evaluate(el=>(el as HTMLElement).dataset);
      return d.worldId==="asylum"?0:Math.hypot(Number(d.authoritativeX)-point.x,Number(d.authoritativeY)-point.y);
    },{timeout:9000}).toBeLessThan(.5);
  }
  if(await world.getAttribute("data-world-id")!=="asylum"){await world.focus();await page.keyboard.press("e");}
  await expect(world).toHaveAttribute("data-world-id","asylum");
  await gameAction(page, () => page.getByRole("button",{name:/Watch together/}).click());
}

test("mobile device activation and authoritative source survive reopening, late join and queue changes",async({browser,page})=>{
  test.setTimeout(180_000);
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),phone=await context.newPage();
  const errors:string[]=[];
  for(const p of [page,phone]){p.on("pageerror",e=>errors.push(e.message));await p.route("https://www.youtube.com/iframe_api",r=>r.fulfill({contentType:"text/javascript",body:fixture}));}
  const first="https://www.youtube.com/watch?v=M7lc1UVf-VE",second="https://www.youtube.com/watch?v=dQw4w9WgXcQ",draft=first;
  try{
    const name="Mobile watching "+Date.now();await page.goto("/");
    await page.getByLabel("Your name",{exact:true}).fill("Media host");await page.getByLabel("Home name",{exact:true}).fill(name);
    await page.getByLabel("Choose a private PIN",{exact:true}).fill("123456");await page.getByRole("button",{name:/Create & enter home/}).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const id=await page.evaluate(async n=>(await(await fetch("/api/homes")).json()).homes.find((h:{name:string})=>h.name===n).id,name);
    await enterIndoor(page);await page.getByLabel("Video link").fill(first);await page.getByRole("button",{name:"Load for everyone",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__yt?.getPlayerState())).toBe(2);
    await page.getByRole("button",{name:"Play together",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__yt?.getPlayerState())).toBe(1);

    await phone.goto("/");await phone.getByLabel("Your name",{exact:true}).fill("Media phone");await phone.getByRole("button",{name:"Join friends",exact:true}).click();
    await phone.getByLabel("Home ID",{exact:true}).fill(id);await phone.getByLabel("Room PIN",{exact:true}).fill("123456");await phone.getByRole("button",{name:"Join your friends"}).click();
    await expect(phone.locator(".connection")).toHaveText("Connected");await enterIndoor(phone);await phone.setViewportSize({width:390,height:844});
    await expect(phone.locator(".active-video-link a")).toHaveAttribute("href",first);
    await expect(phone.getByLabel("Video link")).toHaveValue("");
    await expect(phone.locator(".device-playback-status")).toBeVisible();
    await phone.waitForTimeout(4000); // Device remains blocked while friends advance.
    const hostTime=await page.evaluate(()=>(window as any).__yt.getCurrentTime());
    await phone.getByRole("button",{name:"Enable playback on this device",exact:true}).click();
    await expect.poll(()=>phone.evaluate(()=>(window as any).__yt?.getPlayerState())).toBe(1);
    await expect(phone.locator(".device-playback-status")).toHaveCount(0);
    const aligned=await Promise.all([page,phone].map(p=>p.evaluate(()=>(window as any).__yt.getCurrentTime())));
    console.log("DEVICE_ALIGNMENT_DIAGNOSTICS "+JSON.stringify(await Promise.all([page,phone].map(p=>p.evaluate(()=>({time:(window as any).__yt.getCurrentTime(),state:(window as any).__yt.s,events:(window as any).__ytEvents}))))));
    expect(Math.abs(aligned[0]-aligned[1])).toBeLessThan(.8);
    expect(await page.evaluate(()=>(window as any).__yt.getCurrentTime())).toBeGreaterThanOrEqual(hostTime);
    await expect(page.getByRole("button",{name:"Pause together",exact:true})).toBeVisible();

    await phone.getByLabel("Video link").fill(draft);
    await phone.getByRole("button",{name:"Close shared screen"}).click();
    await gameAction(phone, () => phone.getByRole("button",{name:/Watch together/}).click());
    await expect(phone.getByLabel("Video link")).toHaveValue(draft);
    await expect(phone.locator(".active-video-link a")).toHaveAttribute("href",first);
    await page.getByLabel("Video link").fill(second);await page.getByRole("button",{name:"Replace current video",exact:true}).click();
    await expect(phone.locator(".active-video-link a")).toHaveAttribute("href",second);
    await expect(phone.getByLabel("Video link")).toHaveValue(draft);
    await phone.getByRole("button",{name:"Add to queue",exact:true}).click();
    await expect(page.getByRole("list",{name:"Shared video queue"})).toContainText(draft);
    await expect(phone.locator(".active-video-link a")).toHaveAttribute("href",second);
    await expect(phone.getByLabel("Video link")).toHaveValue(draft);
    await expect(page.locator(".active-video-link a")).toHaveAttribute("href",second);

    await page.getByRole("button",{name:"Play next",exact:true}).click();
    await expect(phone.locator(".active-video-link a")).toHaveAttribute("href",draft);
    await expect(page.locator(".active-video-link a")).toHaveAttribute("href",draft);
    await expect(phone.getByLabel("Video link")).toHaveValue(draft);

    for(const viewport of [{width:390,height:844},{width:320,height:600}]){
      await phone.setViewportSize(viewport);
      const bounds=await phone.locator(".shared-watching.expanded").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height);
      const picture=await phone.locator(".youtube-watching").boundingBox();
      expect(picture!.height).toBeGreaterThan(150);
      expect(Math.abs(picture!.width/picture!.height-16/9)).toBeLessThan(.03);
      await expect(phone.getByLabel("Video link")).toHaveCSS("font-size","16px");
    }
    await phone.screenshot({path:test.info().outputPath("mobile-watching-current.png")});
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
