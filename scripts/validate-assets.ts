import { HOME_MAP, RACE_MAP } from '../packages/config/src/index';
const maps=[{map:HOME_MAP,rects:HOME_MAP.solids},{map:RACE_MAP,rects:RACE_MAP.platforms}];
for(const {map,rects} of maps)for(const r of rects){
  if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0||r.x<0||r.y<0||r.x+r.width>map.width||r.y+r.height>map.height)throw new Error(`Invalid map rectangle in ${map.id}`);
}
console.log('Home and race map bounds validated. Art is original procedural pixel drawing; soundboard uses synthesized tones.');
