export type PinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (profileId: string, homeId: string) => `third-space.room-pin.${profileId}.${homeId}`;
export function sessionPinStorage(): PinStorage | null { try {
    return window.sessionStorage;
}
catch {
    return null;
} }
export function rememberSessionPin(storage: PinStorage | null, profileId: string, homeId: string, revision: number | undefined, pin: string): void {
    if (!storage || !/^\d{6,12}$/.test(pin) || !Number.isInteger(revision))
        return;
    try {
        storage.setItem(key(profileId, homeId), JSON.stringify({ revision, pin }));
    }
    catch { /* Storage is optional. */ }
}
export function readSessionPin(storage: PinStorage | null, profileId: string, homeId: string, revision: number | undefined): string {
    try {
        const value = JSON.parse(storage?.getItem(key(profileId, homeId)) || 'null');
        if (value?.revision === revision && Number.isInteger(revision) && /^\d{6,12}$/.test(value?.pin))
            return value.pin;
        storage?.removeItem(key(profileId, homeId));
    }
    catch { /* Corrupt/unavailable storage is not a credential. */ }
    return '';
}

/** Candidate is never displayed before its current revision or PIN is verified. */
export function readSessionPinCandidate(storage: PinStorage | null, profileId: string, homeId: string): {pin:string;revision:number} | null {
  try {
    const value = JSON.parse(storage?.getItem(key(profileId,homeId)) || "null");
    if (Number.isInteger(value?.revision) && /^\d{6,12}$/.test(value?.pin)) return {pin:value.pin, revision:value.revision};
  } catch { /* Optional browser storage. */ }
  return null;
}
export function forgetSessionPin(storage: PinStorage | null, profileId: string, homeId: string): void {
  try { storage?.removeItem(key(profileId,homeId)); } catch { /* Optional browser storage. */ }
}
