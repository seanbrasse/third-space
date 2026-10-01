/** Presentation only: never replace the authority's accepted createdAt. */
export function chatTime(createdAt: number, locale?: string, timeZone?: string) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    short: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(date),
    full: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone }).format(date),
  };
}
/** Text has its own raster density and screen-space size; sprites stay pixel art. */
export function chatTextMetrics(devicePixelRatio: number, zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { resolution: Math.min(4, Math.max(2, Math.ceil(dpr))), scale: 1 / safeZoom };
}
