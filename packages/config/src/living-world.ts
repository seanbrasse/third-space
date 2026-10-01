/** Canonical server rules. Prices, effects and fear thresholds are never client inputs. */
export const LIVING_WORLD_CONFIG = {
  version: 1,
  potionPrice: 2,
  potionCapacity: 2,
  potionDurationMs: 20_000,
  potionUseCooldownMs: 3_000,
  strengthDamageMultiplier: 1.75,
  strengthBodyMultiplier: 1.35,
  speedMultiplier: 1.6,
  offerDurationMs: 60_000,
  giftCooldownMs: 60_000,
  tradeGoodwillCooldownMs: 120_000,
  rescueRecoveryMs: 60_000,
  rescueRetryMs: 10_000,
  rescueNpcId: 'orchard-worker-mara',
  rescueIncidentId: 'lantern-road-v1',
} as const;

export const LIVING_WORLD_MERCHANTS = {
  'wizard-orin-vale': ['strength'],
  'innkeeper-nessa': ['speed'],
  'witch-tansy-reed': ['strength', 'speed'],
} as const;

export interface NPCFearProfile { threshold: number; memoryMs: number }
/** Timid neighbours remember harm longer; guards regain their composure sooner. */
export function npcFearProfile(npcId: string): NPCFearProfile {
  if (['orchard-worker-mara', 'washer-elsie', 'peasant-pell', 'peasant-lark', 'goblin-nib'].includes(npcId))
    return { threshold: 18, memoryMs: 300_000 };
  if (['guard-iona', 'watch-garrick', 'knight-ser-calder', 'ogre-brindle'].includes(npcId))
    return { threshold: 45, memoryMs: 60_000 };
  return { threshold: 30, memoryMs: 180_000 };
}
