'use client';
import type { SurvivalItem, SurvivalPlayer } from '../../../packages/contracts/src/survival';
/** Render from snapshots only. Equip/use commands leave inventory unchanged until authority acknowledgement. */
export default function SurvivalHUD({ player, disabled = false, onEquip, onUse, onFocusGame }: {
    player: SurvivalPlayer;
    disabled?: boolean;
    onEquip: (item: SurvivalItem) => void;
    onUse: () => void;
    onFocusGame?: () => void;
}) {
    const items = [{ id: 'flashlight' as const, label: 'Flashlight', icon: '▰', available: true, count: undefined }, { id: 'apple' as const, label: 'Apple', icon: '●', available: player.apples > 0, count: player.apples }, { id: 'knife' as const, label: 'Knife', icon: '╱', available: !!player.knifeId, count: undefined }];
    const percent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    return <section className="survival-hud" aria-label="Health and backpack">
  <div className="survival-meters"><label>Health <meter min={0} max={100} low={30} optimum={100} value={percent(player.health)} aria-label="Health"/><span>{percent(player.health)}</span></label><label>Hunger <meter min={0} max={100} low={25} optimum={100} value={percent(player.hunger)} aria-label="Hunger"/><span>{percent(player.hunger)}</span></label></div>
  <div className="survival-hotbar" role="group" aria-label="Equipped item">{items.map(item => <button type="button" key={item.id} aria-label={`${item.label}${item.count === undefined ? '' : `, ${item.count} available`}`} aria-pressed={player.equipped === item.id} disabled={disabled || !item.available} onClick={() => { onEquip(item.id); onFocusGame?.(); }}><span aria-hidden="true">{item.icon}</span><small>{item.label}{item.count === undefined ? '' : ` ×${item.count}`}</small></button>)}<button type="button" className="survival-use" disabled={disabled || player.equipped === 'apple' && !player.apples || player.equipped === 'knife' && !player.knifeId} onClick={() => { onUse(); onFocusGame?.(); }}>{player.equipped === 'apple' ? 'Eat apple' : player.equipped === 'knife' ? 'Swing knife' : 'Toggle light'}</button></div>
  <details><summary>Exploring &amp; combat</summary><p>Hunger pauses by the fire, indoors, and while resting. Find apples on trees and knives in hidden backpacks. With a knife equipped, click a player or use Swing knife outside safe areas.</p></details>
 </section>;
}
