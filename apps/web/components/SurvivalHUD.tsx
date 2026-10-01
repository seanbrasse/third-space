'use client';
import type { SurvivalItem, SurvivalPlayer } from '../../../packages/contracts/src/survival';
const labels = { flashlight: 'Flashlight', apple: 'Apple', knife: 'Knife', 'strength-potion':'Strength potion', 'speed-potion':'Speed potion' };
const doses=(player:SurvivalPlayer,item:SurvivalItem)=>item==='apple'?player.apples:item==='strength-potion'?player.potions?.strength:item==='speed-potion'?player.potions?.speed:undefined;
/** Original pixel silhouettes match the world sprites. */
function ItemIcon({ item }: { item: SurvivalItem }) {
    return <svg className="inventory-icon" viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
        {item === 'flashlight' ? <><path fill="#302f2b" d="M4 14h5v-3h4V7h5v2h3v6h-4v3h-4v3H7v-3H4z"/><path fill="#7c9581" d="M6 14h4v-3h4v6h-4v3H7z"/><path fill="#d3bb7d" d="M14 8h4v3h3v3h-5v-2h-2z"/><path fill="#f5e1a5" d="M18 9h2v4h-2z"/><path fill="#b2c5a0" d="M7 14h2v4H7z"/></>
        : item === 'apple' ? <><path fill="#59312e" d="M5 8h5V6h3v2h5v2h2v8h-2v3H7v-2H4v-9h1z"/><path fill="#c15a43" d="M6 10h11v8h-2v2H8v-3H6z"/><path fill="#e89962" d="M7 11h3v3H7z"/><path fill="#9bac69" d="M13 4h6v2h-4v2h-3z"/><path fill="#806045" d="M11 4h2v5h-2z"/></>
        : item.endsWith('-potion') ? <><path fill="#263c39" d="M9 2h6v7l4 5v7H5v-7l4-5z"/><path fill={item==='strength-potion'?'#b67591':'#75b1a5'} d="M7 14h10v5H7z"/><path fill="#dcc392" d="M9 2h6v3H9z"/><path fill="#e8e4cb" d="M9 13h2v4H9z"/></> : <><path fill="#293638" d="M6 18 17 3h4v6L10 20z"/><path fill="#e4e4d3" d="m10 15 8-11h2v4l-8 9z"/><path fill="#8da9a0" d="m12 15 8-8v2l-7 9z"/><path fill="#bc8b53" d="m6 15 7 5-2 2-7-5z"/><path fill="#72513a" d="m5 18 3 2-3 3H2z"/></>}
    </svg>;
}
/** Snapshot-driven: rejected pickups never appear in a slot. */
export default function SurvivalHUD({ player, disabled = false, onSelect, onUse, onFocusGame, onFinish, finishingTarget, threatened, effects=[], serverTime=0 }: {
    player: SurvivalPlayer; disabled?: boolean; onSelect: (slot: number) => void;
    onUse: () => void; onFocusGame?: () => void; onFinish?:()=>void; finishingTarget?:string; threatened?:boolean;
    effects?:import('../../../packages/contracts/src/living-world').PotionEffect[];serverTime?:number;
}) {
    const percent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    const slots = player.slots ?? ['flashlight', null, null, null, null];
    return <section className="survival-hud" aria-label="Inventory" onPointerDown={event => event.stopPropagation()}>
        {threatened&&<p className="finisher-alert" role="alert">Incoming lunge — move out of the marked circle.</p>}
        {!!effects.length&&<p className="potion-effects" aria-label="Active potions">{effects.filter(e=>e.expiresAt>serverTime).map(e=>`${e.kind==='strength'?'Strength':'Speed'} ${Math.ceil((e.expiresAt-serverTime)/1000)}s`).join(' · ')}</p>}
        <div className="survival-meters">
            <label><span>Health</span><meter min={0} max={100} low={30} optimum={100} value={percent(player.health)} aria-label="Health"/><b>{percent(player.health)}</b></label>
            <label><span>Hunger</span><meter min={0} max={100} low={25} optimum={100} value={percent(player.hunger)} aria-label="Hunger"/><b>{percent(player.hunger)}</b></label>
        </div>
        <div className="survival-hotbar" role="group" aria-label="Inventory slots 1 to 5">
            {slots.map((item, slot) => <button type="button" key={slot} className="inventory-slot" aria-keyshortcuts={String(slot + 1)}
                aria-label={`Slot ${slot + 1}: ${item ? labels[item] + (doses(player,item)!==undefined ? `, ${doses(player,item)} available` : '') : 'Empty'}`}
                aria-pressed={(player.selectedSlot ?? 0) === slot} disabled={disabled}
                title={`${slot + 1} · ${item ? labels[item] : 'Empty'}`} onClick={() => { onSelect(slot); onFocusGame?.(); }}>
                <kbd>{slot + 1}</kbd>{item && <ItemIcon item={item}/>}{item&&doses(player,item)!==undefined && <b className="inventory-count">{doses(player,item)}</b>}
            </button>)}
        </div>
        <button type="button" className="survival-use" disabled={disabled || !player.equipped} onClick={() => { onUse(); onFocusGame?.(); }}>
            {player.equipped === 'strength-potion' ? 'Drink strength' : player.equipped === 'speed-potion' ? 'Drink speed' : player.equipped === 'apple' ? 'Eat apple' : player.equipped === 'knife' ? 'Swing knife' : player.equipped === 'flashlight' ? 'Toggle light' : 'Empty hand'}
        </button>
        {player.equipped==='knife'&&<button type="button" className="survival-finish" disabled={disabled||!finishingTarget} title="Wounded foe ≤55 health; hold still for the visible lunge. They can dodge or interrupt." onClick={()=>{onFinish?.();onFocusGame?.();}}>{finishingTarget?`Lunge at ${finishingTarget}`:'Lunge · wounded foe ≤55'}</button>}
    </section>;
}
