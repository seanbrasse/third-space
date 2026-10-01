export type ConnectionQuality = "checking" | "good" | "slow" | "unstable" | "stalled" | "offline" | "background" | "reconnecting";
/** Signals describe the round trip to this room, not Wi-Fi strength or the cause of lag. */
export function connectionQuality({ online, hidden, connected, age, samples, timeouts }: {
    online: boolean;
    hidden: boolean;
    connected: boolean;
    age: number;
    samples: readonly number[];
    timeouts: number;
}): ConnectionQuality {
    if (hidden)
        return "background";
    // Fresh room packets outweigh navigator.onLine for a local Mac preview.
    if (!online && (!connected || age>2000))return "offline";
    if (!connected)
        return "reconnecting";
    if (age > 2000 || timeouts >= 2)
        return "stalled";
    if (!samples.length)
        return "checking";
    const sorted = [...samples].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)]!;
    if (timeouts || (samples.length >= 3 && sorted.at(-1)! - sorted[0]! > 150))
        return "unstable";
    return median > 250 ? "slow" : "good";
}
