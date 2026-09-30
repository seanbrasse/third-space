import { describe, it, expect } from "vitest";
import { resolveMediaLink } from "../src/media";
describe("pasted video links", () => {
    it("normalizes watch/share/short/live links and timestamps", () => {
        for (const url of ["https://www.youtube.com/watch?v=M7lc1UVf-VE", "https://youtu.be/M7lc1UVf-VE?si=sharing", "https://m.youtube.com/shorts/M7lc1UVf-VE", "https://youtube.com/live/M7lc1UVf-VE", "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE"]) {
            expect(resolveMediaLink(url)).toMatchObject({ kind: "youtube", videoId: "M7lc1UVf-VE", url: "https://www.youtube.com/watch?v=M7lc1UVf-VE" });
        }
        expect(resolveMediaLink("https://youtu.be/M7lc1UVf-VE?t=1m23s").start).toBe(83);
    });
    it("retains HTTPS video files and rejects webpages, credentials and deceptive hosts", () => {
        expect(resolveMediaLink("https://example.com/movie.mp4?signature=sample")).toMatchObject({ kind: "file", start: 0 });
        for (const url of ["https://youtube.com.evil.test/watch?v=M7lc1UVf-VE", "https://youtube.com/@channel", "https://netflix.com/watch/123", "javascript:alert(1)", "https://user:password@youtube.com/watch?v=M7lc1UVf-VE", "http://example.com/movie.mp4"]) {
            expect(() => resolveMediaLink(url)).toThrow();
        }
    });
});
