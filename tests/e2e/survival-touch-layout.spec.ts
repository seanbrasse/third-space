import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {observeSurvivalHUD} from '../../apps/web/lib/survival-hud-layout';

// Explicit layout fixture: actual HUD component, observer and product styles.
// No game/socket/action acceptance or physical-device claim follows from this test.
const css = ['apps/web/app/globals.css', 'apps/web/components/survival-hud.css', 'apps/web/components/npc-interaction-panel.css']
  .map(path => readFileSync(path, 'utf8'));
// Render outside Playwright's JSX transformer (which emits component-test tokens).
const hud = execFileSync(process.execPath, ['--import','tsx','--input-type=module','-e', `
  import {createRequire} from 'node:module';
  import SurvivalHUD from './apps/web/components/SurvivalHUD.tsx';
  const require=createRequire(new URL('./apps/web/package.json',import.meta.url));
  const {createElement}=require('react'), {renderToStaticMarkup}=require('react-dom/server');
  const Component=typeof SurvivalHUD==='function'?SurvivalHUD:SurvivalHUD.default;
  process.stdout.write(renderToStaticMarkup(createElement(Component, {
    player:{id:'layout',health:75,hunger:60,apples:2,slots:['flashlight','knife','apple','strength-potion','speed-potion'],selectedSlot:1,equipped:'knife',potions:{strength:1,speed:1}},
    effects:[{kind:'strength',expiresAt:90000},{kind:'speed',expiresAt:90000}],spiritEffects:{wardUntil:0,snareUntil:6000},serverTime:1000,
    threatened:true,finishingTarget:'A very long wandering friend name',onSelect:()=>{},onUse:()=>{},onFinish:()=>{},
  })));
`], {encoding:'utf8',env:{...process.env,TSX_TSCONFIG_PATH:'./apps/web/tsconfig.json'}});
const cases: Array<{width:number;height:number;fullscreen:boolean;inset:number;compact?:boolean}> = [
  {width:390,height:844,fullscreen:false,inset:0},
  {width:320,height:568,fullscreen:false,inset:0},
  {width:320,height:420,fullscreen:true,inset:34},
  {width:390,height:568,fullscreen:true,inset:34},
  {width:667,height:375,fullscreen:true,inset:21},
  {width:844,height:390,fullscreen:true,inset:21},
  {width:667,height:375,fullscreen:true,inset:21,compact:true},
  {width:844,height:390,fullscreen:true,inset:21,compact:true},
];
for (const size of cases) for (const reverseStyles of [false,true]) {
  test(`LOCAL HUD layout ${size.width}x${size.height} fullscreen=${size.fullscreen} inset=${size.inset} compact=${!!size.compact} reverseCSS=${reverseStyles}`,async({page},testInfo)=>{
    await page.setViewportSize(size);
    // Alias :fullscreen only in the isolated fixture; emulate nonzero safe insets
    // because headless Chrome does not supply a physical iPhone notch/home bar.
    const style = (reverseStyles ? [...css].reverse() : css).join('\n')
      .replaceAll(':fullscreen','.layout-fixture-fullscreen')
      .replaceAll('env(safe-area-inset-bottom)',`${size.inset}px`)
      .replace(/env\(safe-area-inset-(left|right)\)/g,`${size.width>=600&&size.inset?44:0}px`);
    await page.setContent(`<style>${style}</style><main class="app ${size.fullscreen?'layout-fixture-fullscreen':''}" style="padding-left:12px;padding-right:12px"><section class="world-shell home-view forest-view ${size.compact?'compact-npc-conversation':''}"><div class="world-topline">Forest · explicit layout fixture</div><div class="world-canvas" style="background:#273b31">${hud}<button class="nearby-npc-prompt">E · Talk to Tansy Reed</button></div><div class="touch-controls"><div class="dpad">${['up','left','down','right'].map((direction,i)=>`<button class="${direction}" aria-label="Move ${direction}">${['↑','←','↓','→'][i]}</button>`).join('')}</div><button class="touch-action">Hold to sprint</button></div><div class="world-bottomline">Stamina</div></section></main>`);
    await page.addScriptTag({content:`(${observeSurvivalHUD.toString()})(document.querySelector('.survival-hud'));`});
    const assertLayout=async()=>{
      await expect.poll(()=>page.evaluate(()=>{
        const hud=document.querySelector('.survival-hud')!.getBoundingClientRect();
        const movement=document.querySelector('.touch-controls')!.getBoundingClientRect();
        return Math.min(hud.right,movement.right)-Math.max(hud.left,movement.left)<=0 || Math.min(hud.bottom,movement.bottom)-Math.max(hud.top,movement.top)<=0;
      })).toBe(true);
      const violations=await page.evaluate(()=>{
        const world=document.querySelector('.world-canvas')!.getBoundingClientRect();
        const buttons=[...document.querySelectorAll<HTMLElement>('.touch-controls button,.survival-hud button,.nearby-npc-prompt')];
        const errors:string[]=[];
        buttons.forEach((button,i)=>{
          const box=button.getBoundingClientRect(),name=button.getAttribute('aria-label')||button.textContent;
          if(box.width<44||box.height<44)errors.push(`${name}: target below 44px`);
          if(box.left<world.left-.5||box.right>world.right+.5||box.top<world.top-.5||box.bottom>world.bottom+.5)errors.push(`${name}: outside canvas`);
          for(const other of buttons.slice(i+1)){
            const b=other.getBoundingClientRect();
            if(Math.min(box.right,b.right)-Math.max(box.left,b.left)>.5&&Math.min(box.bottom,b.bottom)-Math.max(box.top,b.top)>.5)errors.push(`${name}: overlaps ${other.textContent}`);
          }
        });
        return errors;
      });
      expect(violations).toEqual([]);
    };
    await assertLayout();
    await page.screenshot({path:testInfo.outputPath('combined-warning-effects-knife.png'),fullPage:true});
    // The same mounted observer must handle expiry, equipment changes and rotation.
    await page.locator('.finisher-alert,.potion-effects,.survival-finish').evaluateAll(nodes=>nodes.forEach(node=>node.remove()));
    await assertLayout();
    await page.setViewportSize({width:size.height,height:size.width});
    await assertLayout();
  });
}
