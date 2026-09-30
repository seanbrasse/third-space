export type MediaSource = {
    kind: "youtube";
    url: string;
    videoId: string;
    start: number;
} | {
    kind: "file";
    url: string;
    start: number;
};
/** Resolve supported user links without fetching webpages or extracting protected streams. */
export function resolveMediaLink(value: string): MediaSource {
    let u: URL;
    try {
        u = new URL(value.trim());
    }
    catch {
        throw new Error("Paste a YouTube link or a link to an MP4, WebM or Ogg video.");
    }
    if (u.username || u.password || !["https:", "http:"].includes(u.protocol))
        throw new Error("Use a normal video link without a username or password.");
    const host = u.hostname.toLowerCase(), parts = u.pathname.split("/").filter(Boolean);
    const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host);
    if (youtube || host === "youtu.be" || host === "www.youtu.be") {
        const id = host.endsWith("youtu.be") ? parts[0] : u.pathname === "/watch" ? u.searchParams.get("v") : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : null;
        if (!id || !/^[-_a-zA-Z0-9]{11}$/.test(id))
            throw new Error("Paste a link to a specific YouTube video, rather than a channel or playlist.");
        const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "0";
        const partsTime = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        const start = Math.min(86400, /^\d+$/.test(t) ? Number(t) : partsTime ? Number(partsTime[1] ?? 0) * 3600 + Number(partsTime[2] ?? 0) * 60 + Number(partsTime[3] ?? 0) : 0);
        return { kind: "youtube", url: `https://www.youtube.com/watch?v=${id}`, videoId: id, start };
    }
    if (u.protocol === "https:" && /\.(mp4|webm|ogg)$/i.test(u.pathname))
        return { kind: "file", url: u.href, start: 0 };
    throw new Error("That looks like a webpage. Try a YouTube video link, or a link ending in .mp4, .webm or .ogg. Other sites aren't supported yet.");
}
