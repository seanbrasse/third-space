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
