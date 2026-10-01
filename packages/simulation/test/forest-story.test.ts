import { describe, expect, it } from 'vitest';
import { newSharedForestStory, restoreSharedForestStory, restoreForestMystery, stepSharedForestStory, forestStoryView, STORY_SEALS, STORY_RAIDERS, STORY_GUARDIAN, STORY_SUSPECTS, type ForestStoryEvent, type SharedForestStoryState } from '../src/forest-story';
const mystery = { version: 1, culpritId: 'goblin-nib' } as const;
function fixture() {
  let state = newSharedForestStory(), serial = 0;
  const emit = (detail: Record<string, unknown>, at?: number) => {
    const result = stepSharedForestStory(state, mystery, { eventId: `event-${++serial}`, actorId: 'alice', occurredAt: at ?? serial * 20_000, ...detail } as ForestStoryEvent);
    state = result.state; return result;
  };
  const ward = () => {
    emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    for (const supplyId of [...STORY_SEALS].reverse()) emit({ kind: 'recover', supplyId });
    for (const encounterId of STORY_RAIDERS) emit({ kind: 'encounter-defeated', encounterId, defeatId: encounterId, participantIds: ['alice'] });
    return emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
  };
  const evidence = () => { for (const evidenceId of ['ward-rubbing', 'ada-journal']) emit({ kind: 'inspect', evidenceId }); for (const s of STORY_SUSPECTS) emit({ kind: 'talk', npcId: s.id }); };
  return { emit, ward, evidence, state: () => state, view: () => forestStoryView(state, mystery, serial + 1, []) };
}
describe('shared forest story reducer', () => {
  it('shows discovered leads only, with no future graph or private culprit fields', () => {
    const f = fixture(); expect(f.view()).toMatchObject({ leads: [], evidence: [], suspects: [], objectives: [] });
    f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    const view = f.view(); expect(view.leads.map(l => l.id)).toEqual(['keeper-missing']);
    expect(view.leads[0].connections).toEqual([]); expect(view.evidence).toEqual([]); expect(view.suspects).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/culprit|private_json|keeper-rescue|keeper-inquiry/);
  });
  it('requires the sequential main milestones but allows seals in any order', () => {
    const f = fixture();
    expect(f.emit({ kind: 'recover', supplyId: STORY_SEALS[0] }).status).toBe('out-of-order');
    expect(f.emit({ kind: 'inspect', evidenceId: 'ada-journal' }).status).toBe('out-of-order');
    f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' });
    for (const supplyId of [...STORY_SEALS].reverse()) f.emit({ kind: 'recover', supplyId });
    expect(f.state().seals).toHaveLength(3);
    expect(f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' }).status).toBe('out-of-order');
    expect(f.state().chapter).toBe('wards');
    for (const encounterId of STORY_RAIDERS) f.emit({ kind: 'encounter-defeated', encounterId });
    expect(f.emit({ kind: 'talk', npcId: 'wizard-orin-vale' }).milestones).toEqual(['wards-restored']);
    expect(f.state().chapter).toBe('inquiry');
  });
  it('requires both physical clues and every interview before accusation', () => {
    const f = fixture(); f.ward();
    expect(f.emit({ kind: 'accuse', suspectId: mystery.culpritId }).status).toBe('need-evidence');
    f.emit({ kind: 'inspect', evidenceId: 'ward-rubbing' });
    for (const suspect of STORY_SUSPECTS) f.emit({ kind: 'talk', npcId: suspect.id });
    expect(f.emit({ kind: 'accuse', suspectId: mystery.culpritId }).status).toBe('need-evidence');
    f.emit({ kind: 'inspect', evidenceId: 'ada-journal' });
    expect(f.emit({ kind: 'accuse', suspectId: mystery.culpritId }).state.chapter).toBe('rescue');
  });
  it('makes the physical clue and testimonies logically identify each possible face', () => {
    const f = fixture(); f.ward(); f.evidence();
    for (const suspect of STORY_SUSPECTS) {
      const view = forestStoryView(f.state(), { version: 1, culpritId: suspect.id }, 20, []);
      expect(view.evidence.find(e => e.id === 'ward-rubbing')?.text).toContain(suspect.mark);
      expect(view.suspects.find(s => s.id === suspect.id)?.testimony).toBe(suspect.testimony);
      expect(view).not.toHaveProperty('culpritId');
      expect(view).not.toHaveProperty('confirmedFace');
    }
  });
  it('preserves all evidence after a wrong accusation and permits a fair retry', () => {
    const f = fixture(); f.ward(); f.evidence();
    const evidence = [...f.state().evidence], interviews = [...f.state().interviews];
    const wrong = f.emit({ kind: 'accuse', suspectId: 'flirt-fenn' }, 500_000);
    expect(wrong.status).toBe('wrong-accusation'); expect(wrong.message).toContain('Nobody is punished');
    expect(f.state().evidence).toEqual(evidence); expect(f.state().interviews).toEqual(interviews);
    expect(f.emit({ kind: 'accuse', suspectId: mystery.culpritId }, 500_100).status).toBe('cooldown');
    expect(f.emit({ kind: 'accuse', suspectId: mystery.culpritId }, 510_000).state.chapter).toBe('rescue');
  });
  it('finishes only after guardian defeat and a real rescue interaction', () => {
    const f = fixture(); f.ward(); f.evidence(); f.emit({ kind: 'accuse', suspectId: mystery.culpritId });
    expect(f.emit({ kind: 'rescue', npcId: 'keeper-ada' }).status).toBe('out-of-order');
    f.emit({ kind: 'encounter-defeated', encounterId: STORY_GUARDIAN });
    expect(f.state().chapter).toBe('rescue');
    expect(f.emit({ kind: 'rescue', npcId: 'keeper-ada' }).milestones).toEqual(['keeper-rescued']);
    expect(f.view().chapter).toBe('complete'); expect(f.view().objectives.every(o => o.complete)).toBe(true);
    expect(f.emit({ kind: 'rescue', npcId: 'keeper-ada' }).milestones).toEqual([]);
  });
  it('lets flexible sideplots be discovered, interleaved and completed without starting the main story', () => {
    const f = fixture();
    f.emit({ kind: 'talk', npcId: 'cheesemonger-merrit' }); f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' });
    expect(f.view().chapter).toBe('undiscovered'); expect(f.view().leads.map(l => l.id)).toEqual(['a-fair-rind', 'reed-and-ash']);
    f.emit({ kind: 'talk', npcId: 'warlock-vesper' }); f.emit({ kind: 'talk', npcId: 'goblin-pip' });
    expect(f.emit({ kind: 'talk', npcId: 'cheesemonger-merrit' }).milestones).toEqual(['fair-rind']);
    expect(f.emit({ kind: 'talk', npcId: 'witch-tansy-reed' }).milestones).toEqual(['kept-cup']);
    expect(f.view().leads.every(l => l.status === 'complete')).toBe(true);
  });
  it('defensively restores valid state and rejects unknown versions or impossible completions', () => {
    const f = fixture(); f.ward(); f.evidence();
    const restored = restoreSharedForestStory(JSON.parse(JSON.stringify(f.state()))); restored.seals.pop();
    expect(f.state().seals).toHaveLength(3);
    for (const raw of [{ ...f.state(), version: 2 }, { ...f.state(), seals: ['forged'] }, { ...f.state(), chapter: 'complete' }, { ...f.state(), sides: { fairRind: 9, keptCup: 0 } }, { ...f.state(), interviews: ['flirt-fenn', 'flirt-fenn'] }]) expect(() => restoreSharedForestStory(raw)).toThrow();
    expect(() => restoreForestMystery({ version: 2, culpritId: mystery.culpritId })).toThrow();
  });
});
