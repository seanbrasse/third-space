export type RoomInvite = { home: string; pin?: string; inviteToken?: string };
const validHome = (value: string) => /^[a-z]{1,7}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Fragment credentials never enter HTTP query strings or server access logs. */
export function parseRoomInvite(fragment: string): RoomInvite | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const home = (params.get("home") || "").trim().toLowerCase();
  if (!validHome(home)) return null;
  const inviteToken = params.get("invite");
  if (inviteToken && /^[a-zA-Z0-9_-]{1,128}$/.test(inviteToken)) return { home, inviteToken };
  const pin = params.get("pin");
  if (pin && /^\d{6,12}$/.test(pin)) return { home, pin };
  return null;
}
export function buildRoomInvite(origin: string, home: string, pin: string): string {
  if (!validHome(home) || !/^\d{6,12}$/.test(pin)) throw new Error("A verified room PIN and home ID are required.");
  const url = new URL("/", origin);
  url.search = "";
  url.hash = new URLSearchParams({ home: home.toLowerCase(), pin }).toString();
  return url.toString();
}
