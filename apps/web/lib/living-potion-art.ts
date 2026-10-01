import type {AvatarConfig,Facing} from '@third-space/contracts';
import {drawAvatarCanvas,shade} from './pixel-art';
import {ArtBuilder,livingArtCanvas,type LivingArt} from './living-art-primitives';

/** Capture the original avatar's pixel commands, not a browser or screenshot.
 * Keeping the one source of head artwork preserves every hair/accessory/facing
 * combination when the strength potion changes the body silhouette. */
export function personalAvatarArt(avatar:AvatarConfig,facing:Facing='down',frame=0):LivingArt {
 const b=new ArtBuilder(24,32);
 const context={fillStyle:'#000000',imageSmoothingEnabled:false,clearRect(){},fillRect(x:number,y:number,w:number,h:number){b.rect(x,y,w,h,this.fillStyle);}};
 const target={width:24,height:32,getContext:()=>context} as unknown as HTMLCanvasElement;
 drawAvatarCanvas(target,avatar,facing,frame);return b.build();
}
export function livingStrengthAvatarArt(avatar:AvatarConfig,facing:Facing='down',frame=0):LivingArt {
 const b=new ArtBuilder(34,43),skin=avatar.skinColor||avatar.color,shirt=avatar.clothingColor||'#688f79',pants=avatar.trouserColor||'#43556e';
 const step=[0,1,0,-1][((frame%4)+4)%4]!,ink='#241c20';
 b.ellipse(17,41,15,2,'#28372f55');
 b.poly([[7,29],[16,30],[15,38+step],[14,41],[4,41],[5,37+step]],shade(pants,-18));
 b.poly([[18,30],[27,29],[28,37-step],[29,41],[19,41],[18,38-step]],pants);
 b.rect(3,39+step,12,3,ink).rect(19,39-step,12,3,ink).rect(6,32,3,6,shade(pants,12)).rect(22,31,3,7,shade(pants,15));
 // Broad shoulder line, pectoral planes, heavy forearms and a tapered waist;
 // this is original anatomy, not an enlarged copy of the ordinary sprite.
 b.poly([[8,15],[25,15],[31,19],[29,30],[24,34],[10,34],[5,30],[3,20]],ink);
 b.poly([[9,16],[24,16],[28,20],[25,31],[22,33],[12,33],[8,30],[5,20]],shirt);
 b.poly([[9,18],[15,17],[15,25],[10,26],[7,23]],shade(shirt,28));
 b.poly([[18,17],[25,18],[28,23],[23,26],[18,25]],shade(shirt,12));
 b.rect(15,20,3,11,shade(shirt,-25)).rect(10,28,5,2,shade(shirt,-14)).rect(19,28,5,2,shade(shirt,-23));
 b.poly([[5,18+step],[10,19+step],[9,26+step],[7,28+step],[1,27+step],[1,21+step]],shade(shirt,-12));
 b.poly([[25,19-step],[29,18-step],[33,21-step],[33,27-step],[27,28-step],[25,25-step]],shade(shirt,7));
 b.poly([[1,26+step],[7,25+step],[9,31+step],[7,35+step],[2,35+step],[0,32+step]],shade(skin,-8));
 b.poly([[27,25-step],[33,26-step],[34,32-step],[32,35-step],[27,35-step],[25,31-step]],skin);
 b.rect(2,28+step,2,5,shade(skin,23)).rect(28,28-step,2,5,shade(skin,23)).rect(4,33+step,3,1,shade(skin,-22)).rect(28,33-step,3,1,shade(skin,-22));
 if(avatar.outfit==='overalls'){b.rect(11,19,3,13,pants).rect(21,19,3,13,pants).rect(12,26,12,7,pants).rect(12,23,2,2,'#e9cc87').rect(21,23,2,2,'#e9cc87');}
 else if(avatar.outfit==='hoodie')b.rect(11,27,12,3,shade(shirt,-20)).rect(12,19,1,5,'#eadfbc').rect(21,19,1,5,'#eadfbc');
 else if(avatar.outfit==='jacket')b.rect(16,17,2,16,shade(shirt,-40)).rect(13,17,1,7,shade(shirt,40)).rect(20,17,1,7,shade(shirt,40));
 // The original face remains exactly 24px wide, with no green-skin substitution.
 // Capture the head pass rather than cropping its height: long hair hangs over
 // the new shoulders for exactly the same length as the personal avatar.
 const personal=personalAvatarArt(avatar,facing,frame).commands;
 const headStart=personal.findIndex(c=>c.kind==='rect'&&c.x===7&&c.y===3&&c.width===10&&c.height===2);
 for(const c of personal.slice(headStart)){if(c.kind==='rect')b.rect(c.x+5,c.y,c.width,c.height,c.fill);}
 return b.build();
}
export function livingStrengthAvatarCanvas(avatar:AvatarConfig,facing:Facing='down',frame=0):HTMLCanvasElement{return livingArtCanvas(livingStrengthAvatarArt(avatar,facing,frame));}
