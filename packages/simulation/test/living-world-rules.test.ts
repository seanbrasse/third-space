import { describe, expect, it } from 'vitest';
import { activePotionEffects, fearAt, lanternRoadView, livingWorldOfferDefinitions, newLanternRoad, newNpcMemory, npcTrustAt, potionMultipliers, relationshipView, rememberGoodwill, rememberHarm, rememberKindness } from '../src/living-world-rules';
import type { LivingWorldSnapshot } from '../../contracts/src/living-world';

function snapshot(): LivingWorldSnapshot {
  return { revision: 1, serverTime: 1_000, personal: { trust: 0, reputation: 'neighbour', inventory: { apples: 5, revision: 1, potions: { strength: 0, speed: 0 } }, effects: [], useReadyAt: 0, relationships: [], badges: [], rewards: [] }, rescue: lanternRoadView(newLanternRoad()) };
}
describe('living-world server rules', () => {
  it('uses different fear thresholds and memory lengths, with bounded gradual recovery', () => {
    const mara = rememberHarm(newNpcMemory('orchard-worker-mara'), 1_000, true);
    const guard = rememberHarm(newNpcMemory('guard-iona'), 1_000, true);
    expect(relationshipView(mara, 1_000)).toMatchObject({ afraid: true, fearThreshold: 18 });
    expect(relationshipView(guard, 1_000)).toMatchObject({ afraid: true, fearThreshold: 45 });
    expect(fearAt(guard, 61_000)).toBe(0);
    expect(fearAt(mara, 61_000)).toBe(48);
    expect(fearAt(mara, 301_000)).toBe(0);
    expect(rememberKindness(mara, 61_000, 100).fear).toBe(0);
    expect(rememberHarm(rememberHarm(mara, 1_000, true), 1_000, true).fear).toBe(100);
  });
  it('never blocks keeper conversation while afraid; server owns stock and prices', () => {
    const s = snapshot(); s.personal.trust = -100;
    s.personal.relationships = [relationshipView(rememberHarm(newNpcMemory('wizard-orin-vale'), 1_000, true), 1_000)];
    const offers = livingWorldOfferDefinitions(s, 'wizard-orin-vale');
    expect(offers.find(o => o.kind === 'talk')?.disabledReason).toBeUndefined();
    expect(offers.find(o => o.kind === 'trade')).toMatchObject({ potion: 'strength', appleCost: 2, disabledReason: expect.any(String) });
    expect(livingWorldOfferDefinitions(s, 'innkeeper-nessa').find(o => o.kind === 'trade')?.potion).toBe('speed');
    expect(livingWorldOfferDefinitions(s, 'cheesemonger-merrit').some(o => o.kind === 'trade')).toBe(false);
    expect(livingWorldOfferDefinitions(s, 'forged-merchant')).toEqual([]);
  });
  it('recovers negative local trust on independent clocks while positive kindness lasts', () => {
    const mara = rememberHarm(newNpcMemory('orchard-worker-mara'), 1_000, true);
    const guard = rememberHarm(newNpcMemory('guard-iona'), 1_000, false);
    expect(npcTrustAt(mara, 1_000)).toBe(-18); expect(npcTrustAt(guard, 1_000)).toBe(-10);
    expect(npcTrustAt(mara, 61_000)).toBe(-15); expect(npcTrustAt(guard, 61_000)).toBe(0);
    const calm = rememberKindness(mara, 61_000, 100);
    expect(fearAt(calm, 61_000)).toBe(0); expect(npcTrustAt(calm, 61_000)).toBe(-15);
    const repaired = rememberGoodwill(calm, 61_000, 5, 30);
    expect(npcTrustAt(repaired, 61_000)).toBe(-10); expect(repaired.trustRecoverAt).toBe(mara.trustRecoverAt);
    expect(npcTrustAt(repaired, 301_000)).toBe(0);
    const positive = rememberGoodwill(newNpcMemory('innkeeper-nessa'), 1_000, 5, 30);
    expect(npcTrustAt(positive, 99_000_000)).toBe(5);
  });
  it('respects a local merchant refusal after fear is calmed and never caps a stronger earned bond downward', () => {
    const s = snapshot(), harmed = rememberHarm(rememberHarm(newNpcMemory('wizard-orin-vale'), 1_000, true), 1_000, true);
    s.personal.relationships = [relationshipView(rememberKindness(harmed, 1_000, 100), 1_000)];
    expect(s.personal.relationships[0]).toMatchObject({ afraid: false, trust: -36 });
    expect(livingWorldOfferDefinitions(s, 'wizard-orin-vale').find(offer => offer.kind === 'trade')?.disabledReason).toContain('trust');
    const bond = rememberGoodwill(newNpcMemory('orchard-worker-mara'), 1_000, 40, 100);
    expect(rememberGoodwill(bond, 2_000, 5, 30).trust).toBe(40);
    expect(rememberGoodwill(bond, 2_000, 2, 0).trust).toBe(40);
  });
  it('exposes active effects only until the server deadline with exact bounded multipliers', () => {
    const effects = [{ kind: 'strength' as const, startedAt: 1_000, expiresAt: 21_000 }, { kind: 'speed' as const, startedAt: 4_000, expiresAt: 24_000 }];
    expect(potionMultipliers(effects, 4_000)).toEqual({ damage: 1.75, body: 1.35, speed: 1.6 });
    expect(potionMultipliers(effects, 21_000)).toEqual({ damage: 1, body: 1, speed: 1.6 });
    expect(activePotionEffects(effects, 24_000)).toEqual([]);
    expect(potionMultipliers(effects, 1_000_000)).toEqual({ damage: 1, body: 1, speed: 1 });
  });
  it('keeps an undiscovered rescue quiet and provides the no-apple recovery route', () => {
    expect(lanternRoadView(newLanternRoad())).toMatchObject({ discovered: false, summary: '', objective: '' });
    const s = snapshot(); s.rescue.stage = 'recovering'; s.personal.inventory.apples = 0;
    expect(livingWorldOfferDefinitions(s, 'orchard-worker-mara').find(o => o.kind === 'give')?.disabledReason).toBeTruthy();
    expect(lanternRoadView({ ...newLanternRoad(), discovered: true, stage: 'recovering', recoveryAt: 61_000 }).objective).toContain('rest');
  });
});
