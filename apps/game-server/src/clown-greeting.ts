/** Original text, chosen once by authority without consuming encounter RNG. */
export const CLOWN_GREETINGS = [
  'There you are…', 'You left the light on for me.', 'The fire cannot follow you.',
  'I saved you a seat. Far away.', 'Which tree will you hide behind?',
  'Walk a little farther.', 'I heard your footsteps.', 'I know the path back, too.',
] as const;
export function chooseClownGreeting(encounterId:string,coverId:string,now:number) {
 let hash=2166136261;
 for(const c of `${encounterId}:${coverId}:${now}`)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
 return {id:`${encounterId}:hello`,text:CLOWN_GREETINGS[hash%CLOWN_GREETINGS.length]!,shownAt:now,until:now+4500};
}
