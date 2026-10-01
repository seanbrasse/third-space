import type { TakedownCreature } from '../lib/takedown';
/** Original low-resolution silhouette art. Deliberately no wound/gore frames. */
export default function TakedownCreature({ kind }: { kind: TakedownCreature }) {
  return kind === 'mimic' ? <svg viewBox="0 0 32 48" aria-hidden="true" shapeRendering="crispEdges">
    <path fill="#11161a" d="M12 0h10v3H12zM9 3h16v12H9zM7 15h18v15H7zM3 17h4v22H3zm22 0h3v24h-3zM8 30h5v18H8zm10 0h5v18h-5z"/>
    <path fill="#68766c" d="M9 4h2v9H9zM7 16h2v14H7zM4 30h2v11H4zm21-4h2v17h-2z"/>
    <path fill="#c8cbb4" d="M12 6h4v1h-4zm7-1h4v1h-4z"/><path fill="#030406" d="M14 10h6v6h-6z"/>
  </svg> : kind === 'clown' ? <svg viewBox="0 0 32 40" aria-hidden="true" shapeRendering="crispEdges">
    <path fill="#7d3740" d="M8 0h16v4H8zM4 4h24v4H4z"/>
    <path fill="#d5cbb4" d="M8 8h16v12H8z"/><path fill="#bc3542" d="M13 13h6v4h-6z"/>
    <path fill="#16151c" d="M9 10h4v3H9zm10 0h4v3h-4zM10 18h12v2H10z"/>
    <path fill="#827481" d="M8 20h16v12H8zM4 22h4v10H4zm20 0h4v10h-4z"/>
    <path fill="#9a3540" d="M14 22h4v4h-4zm0 6h4v4h-4z"/>
    <path fill="#514557" d="M8 32h6v8H8zm10 0h6v8h-6z"/><path fill="#b8aa95" d="M0 29h8v3H0zm24 0h8v3h-8z"/>
  </svg> : <svg viewBox="0 0 44 32" aria-hidden="true" shapeRendering="crispEdges">
    <path fill="#575362" d="M12 9h18v13H12zM5 12h12v10H5zM30 4h9v16h-9zM27 0h5v8h-5zm9 0h5v9h-5zM38 12h6v7h-6z"/>
    <path fill="#99919b" d="M30 15h14v5H30zM12 20h18v3H12z"/>
    <path fill="#bf555b" d="M35 9h3v3h-3z"/><path fill="#bcb7ac" d="M39 18h2v3h-2z"/>
    <path fill="#393744" d="M8 21h6v11H8zm15 0h5v11h-5zm8-2h5v13h-5zM0 10h7v5H0z"/>
  </svg>;
}
