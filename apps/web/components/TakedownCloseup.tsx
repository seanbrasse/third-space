import type { TakedownCreature } from '../lib/takedown';
/** Original front-facing pixel portraits, independent from another player's identity. */
export default function TakedownCloseup({kind}:{kind:TakedownCreature}) {
 return <svg viewBox="0 0 64 64" aria-hidden="true" shapeRendering="crispEdges">
  {kind==='clown'?<>
   <path fill="#3d1827" d="M9 5h46v10H9zM4 15h56v9H4zM1 24h12v26H1zm50 0h12v26H51z"/>
   <path fill="#8a3945" d="M17 1h30v5H17zM10 7h44v9H10z"/>
   <path fill="#c8bca7" d="M13 20h38v26H13zM18 46h28v9H18z"/>
   <path fill="#16121c" d="M15 23h13v7H15zm22 0h13v7H37zM20 41h25v10H20z"/>
   <path fill="#a44449" d="M23 26h3v2h-3zm15 0h3v2h-3zM27 31h10v8H27zM15 34h4v10h-4zm32 0h3v10h-3z"/>
   <path fill="#ded3b8" d="M22 42h3v4h-3zm6 0h3v5h-3zm6 0h3v5h-3zm6 0h3v4h-3z"/>
   <path fill="#514452" d="M7 56h50v8H7zM18 52h10v6H18zm18 0h10v6H36z"/>
  </>:kind==='werewolf'?<>
   <path fill="#29252f" d="M4 0h14v19H4zm42 0h14v19H46zM11 13h43v34H11zM4 24h9v23H4zm48 0h9v23h-9zM17 45h30v17H17z"/>
   <path fill="#66606e" d="M11 20h17v6H11zm26 0h17v6H37zM18 35h28v9H18zM23 44h18v14H23z"/>
   <path fill="#ad5257" d="M16 27h10v3H16zm22 0h10v3H38z"/><path fill="#0e0d13" d="M26 35h12v7H26zM22 45h20v12H22z"/>
   <path fill="#c4bfae" d="M23 44h4v9h-4zm14 0h4v9h-4zM28 52h3v5h-3zm6 0h3v5h-3z"/>
  </>:<>
   <path fill="#16181c" d="M18 0h27v6H18zM12 6h39v13H12zM8 19h48v25H8zM15 44h35v20H15z"/>
   <path fill="#66746e" d="M12 9h4v33h-4zm36 4h3v27h-3zM17 44h3v20h-3z"/>
   <path fill="#c4c9b5" d="M17 24h12v3H17zm20-3h11v3H37z"/>
   <path fill="#020305" d="M23 38h19v24H23z"/><path fill="#a6ad9d" d="M24 38h3v9h-3zm13 0h3v9h-3zM28 55h3v7h-3zm6-2h3v9h-3z"/>
  </>}
 </svg>;
}
