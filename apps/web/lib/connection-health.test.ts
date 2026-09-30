import { describe, it, expect } from "vitest";
import { connectionQuality } from "./connection-health";
const healthy = { online: true, hidden: false, connected: true, age: 50, samples: [20, 22, 25], timeouts: 0 };
describe("room connection health", () => {
    it("reports measured delay and uneven delivery separately", () => {
        expect(connectionQuality(healthy)).toBe("good");
        expect(connectionQuality({ ...healthy, samples: [300, 310, 320] })).toBe("slow");
        expect(connectionQuality({ ...healthy, samples: [20, 200, 35] })).toBe("unstable");
        expect(connectionQuality({ ...healthy, timeouts: 1 })).toBe("unstable");
    });
    it("detects stalled room updates even if pings answer", () => {
        expect(connectionQuality({ ...healthy, age: 2500 })).toBe("stalled");
        expect(connectionQuality({ ...healthy, timeouts: 2 })).toBe("stalled");
    });
    it("does not blame background tabs and prioritizes offline/reconnecting", () => {
        expect(connectionQuality({ ...healthy, age: 30000, hidden: true })).toBe("background");
        expect(connectionQuality({ ...healthy, online: false, hidden: true })).toBe("offline");
        expect(connectionQuality({ ...healthy, connected: false })).toBe("reconnecting");
        expect(connectionQuality({ ...healthy, samples: [] })).toBe("checking");
    });
});
