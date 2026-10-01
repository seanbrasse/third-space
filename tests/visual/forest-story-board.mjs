/** Isolated real-browser layout/input verification, no app server or backend.
 * node tests/visual/forest-story-board.mjs
 * Optional PLAYWRIGHT_CHROMIUM_EXECUTABLE and STORY_BOARD_EVIDENCE_DIR. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url),tsxRequire=createRequire(require.resolve('tsx'));
const {build}=tsxRequire('esbuild');
const root=fileURLToPath(new URL('../../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'third-space-story-board-'));
const evidence=resolve(process.env.STORY_BOARD_EVIDENCE_DIR??temporary);await mkdir(evidence,{recursive:true});
await build({entryPoints:[join(root,'apps/web/fixtures/forest-story-board.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',outfile:join(temporary,'fixture.js')});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
try{
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#15291f;color:#ded7b9;font:14px system-ui}.world-shell{padding:12px}body>img{margin:32px}</style><div id="root"></div>');
  await page.addStyleTag({content:await readFile(join(temporary,'fixture.css'),'utf8')});await page.addScriptTag({path:join(temporary,'fixture.js')});
  await page.getByRole('button',{name:'Open noticeboard'}).click();
  const dialog=page.getByRole('dialog',{name:'The noticeboard'});await dialog.waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'Close noticeboard'}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await dialog.locator('text=unreached-private-plot').count(),0);checks.push('initial focus and undiscovered connection suppression');
  await dialog.screenshot({path:join(evidence,'story-board-desktop.png')});
  const leads=page.getByRole('tab',{name:/Leads/});await leads.focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:/Evidence/}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:/Recap/}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');assert.equal(await leads.getAttribute('aria-selected'),'true');checks.push('roving tab arrows/Home/End');
  await page.keyboard.press('Digit1');await page.keyboard.press('Digit5');await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>window.storyBoardFixture.gameKeys),0);checks.push('inventory/sprint keys stay inside dialog');
  for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}checks.push('native focus containment');
  await page.getByRole('tab',{name:/People/}).click();const discuss=page.getByRole('button',{name:'Discuss this face with Orin'});assert.equal(await discuss.count(),3);assert.equal(await discuss.first().isDisabled(),true);
  await page.evaluate(()=>window.storyBoardFixture.setCanAccuse(true));await discuss.first().click();assert.ok(await page.evaluate(()=>window.storyBoardFixture.accusedId));checks.push('distant board read-only; authorized discussion emits only an ID');
  await leads.click();await page.getByRole('button',{name:'Collect reward'}).click();assert.equal(await page.evaluate(()=>window.storyBoardFixture.rewardId),'reward:wards');checks.push('claim emits reward ID without local grant');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>window.storyBoardFixture.focusReturns===1);
  assert.equal(await page.locator('.world-canvas').evaluate(el=>el===document.activeElement),true);checks.push('Escape closes and invokes world-focus callback once');
  await page.getByRole('button',{name:'Fullscreen world'}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
  await page.getByRole('button',{name:'Open noticeboard'}).click();await dialog.waitFor({state:'visible'});assert.equal(await dialog.evaluate(el=>document.fullscreenElement?.contains(el)),true);
  await page.getByRole('button',{name:'Close noticeboard'}).click();await dialog.waitFor({state:'hidden'});await page.evaluate(()=>document.exitFullscreen());checks.push('native modal remains accessible inside fullscreen world shell');
  for(const viewport of[{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.getByRole('button',{name:'Open noticeboard'}).click();await dialog.waitFor({state:'visible'});
    const layout=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,bodyWidth:document.documentElement.scrollWidth,buttons:[...el.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({h:e.getBoundingClientRect().height,w:e.getBoundingClientRect().width})),scroll:[...el.querySelectorAll('.story-board-scroll')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))};});
    assert.ok(layout.x>=0&&layout.y>=0&&layout.right<=viewport.width&&layout.bottom<=viewport.height,JSON.stringify(layout));
    assert.ok(layout.bodyWidth<=viewport.width);assert.ok(layout.buttons.every(b=>b.h>=44&&b.w>=44));assert.ok(layout.scroll.every(s=>s.scroll<=s.width));
    if(viewport.width===390){await dialog.screenshot({path:join(evidence,'story-board-mobile.png')});await page.getByRole('tab',{name:/Evidence/}).click();await dialog.screenshot({path:join(evidence,'story-board-evidence-mobile.png')});}
    await page.getByRole('button',{name:'Close noticeboard'}).click();await dialog.waitFor({state:'hidden'});
    checks.push(`${viewport.width}×${viewport.height}: bounds,44px controls,no horizontal overflow`);
  }
  const onlySide=await page.evaluate(()=>{const s=structuredClone(window.storyBoardFixture.sample);s.story.chapter='undiscovered';s.story.leads=s.story.leads.filter(l=>l.id==='a-fair-rind');s.story.evidence=[];s.story.suspects=[];s.story.recap=[];s.personal.catchUp=[];s.personal.rewards=[];return s;});
  await page.evaluate(s=>window.storyBoardFixture.setSnapshot(s),onlySide);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open noticeboard'}).click();await leads.click();
  assert.equal(await page.getByRole('heading',{name:'Neighbours, Not Thieves'}).count(),1);assert.equal(await page.getByRole('heading',{name:'A Kindness It Cannot Copy'}).count(),0);checks.push('side-first world shows discovered lead without main spoilers');
  await page.getByRole('button',{name:'Close noticeboard'}).click();await page.locator('body>img').screenshot({path:join(evidence,'physical-story-board.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,evidence},null,2));
}finally{await browser.close();}
