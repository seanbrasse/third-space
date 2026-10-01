import { gameAction } from "./menu-actions";
import { test, expect } from "@playwright/test";

test("short alias invite pre-fills without joining; saved-tab PIN survives metadata mismatch and refresh", async ({browser,page}) => {
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const roomName=`Alias invite ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('Your name',{exact:true}).fill('Alias host');
  await page.getByLabel('Home name',{exact:true}).fill(roomName);
  await page.getByLabel('Choose a private PIN',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Create & enter home'}).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  const home=await page.evaluate(async name=>(await (await fetch('/api/homes')).json()).homes.find((h:{name:string})=>h.name===name),roomName);
  expect(home.joinAlias).toMatch(/^[a-z]{1,7}$/);
  await page.evaluate(()=>{
    for(let i=0;i<sessionStorage.length;i++){
      const key=sessionStorage.key(i)!;
      if(key.startsWith('third-space.room-pin.')){const value=JSON.parse(sessionStorage.getItem(key)!);sessionStorage.setItem(key,JSON.stringify({...value,revision:value.revision-1}));}
    }
    Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async(value:string)=>{(window as unknown as {copiedInvite:string}).copiedInvite=value;}});
  });
  await gameAction(page, () => page.getByRole('button',{name:'Session info',exact:true}).click());
  const info=page.getByRole('region',{name:'Session info'});
  await info.getByRole('button',{name:'Reveal PIN'}).click();
  await expect(info.getByLabel('Room PIN',{exact:true})).toHaveValue('123456');
  await expect(info.getByLabel('Home ID',{exact:true})).toHaveValue(home.joinAlias);
  await info.getByRole('button',{name:'Copy invite link'}).click();
  const link=await page.evaluate(()=>(window as unknown as {copiedInvite:string}).copiedInvite);
  expect(new URL(link).search).toBe('');
  const context=await browser.newContext();const friend=await context.newPage();
  try{
    await friend.goto(link);
    await expect(friend.getByLabel('Home ID',{exact:true})).toHaveValue(home.joinAlias);
    await expect(friend.getByLabel('Room PIN',{exact:true})).toHaveValue('123456');
    expect(new URL(friend.url()).hash).toBe('');
    await expect(friend.locator('.world-canvas')).toHaveCount(0);
    await friend.getByLabel('Your name',{exact:true}).fill('Invited friend');
    await friend.getByRole('button',{name:'Join your friends'}).click();
    await expect(friend.locator('.connection')).toHaveText('Connected');
    await friend.reload();await expect(friend.locator('.connection')).toHaveText('Connected');
    await gameAction(friend, () => friend.getByRole('button',{name:'Session info',exact:true}).click());
    const friendInfo=friend.getByRole('region',{name:'Session info'});
    await friendInfo.getByRole('button',{name:'Reveal PIN'}).click();
    await expect(friendInfo.getByLabel('Room PIN',{exact:true})).toHaveValue('123456');
  }finally{await context.close();}
  await page.getByRole('button',{name:'Close game menu'}).click();
  await page.locator('.room-note').getByRole('button',{name:'Leave home',exact:true}).click();
  await expect(page.locator('.saved-homes')).toBeVisible();
  await page.locator('.saved-homes').getByRole('button',{name:roomName,exact:false}).click();
  await expect(page.locator('.connection')).toHaveText('Connected');
  await gameAction(page,()=>page.getByRole('button',{name:'Session info',exact:true}).click());
  await page.getByRole('region',{name:'Session info'}).getByRole('button',{name:'Reveal PIN'}).click();
  await expect(page.getByRole('region',{name:'Session info'}).getByLabel('Room PIN',{exact:true})).toHaveValue('123456');
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));expect(errors).toEqual([]);
  await page.reload();await expect(page.locator('.connection')).toHaveText('Connected');
  await gameAction(page,()=>page.getByRole('button',{name:'Session info',exact:true}).click());
  await page.getByRole('region',{name:'Session info'}).getByRole('button',{name:'Reveal PIN'}).click();
  await expect(page.getByRole('region',{name:'Session info'}).getByLabel('Room PIN',{exact:true})).toHaveValue('123456');
});
