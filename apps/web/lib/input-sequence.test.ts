import { describe, expect, it } from "vitest";
import { InputSequence } from "./input-sequence";
describe("acknowledged input sequence", () => {
  it("starts at authoritative ack on scene recreation", () => {
    const seq = new InputSequence(); seq.observe("room", 9000, true);
    expect(seq.next(true)).toBe(9001);
  });
  it("bounds lost packets rather than raising the server validation cap", () => {
    const seq = new InputSequence(); seq.observe("room", -1, true);
    for (let i=0;i<128;i++) expect(seq.next(true)).toBe(i);
    for (let i=0;i<20000;i++) expect(seq.next(true)).toBeNull();
    seq.observe("room", 127, true); expect(seq.next(true)).toBe(128);
  });
  it("does not allocate while hidden or disconnected, and resyncs reconnect", () => {
    const seq = new InputSequence(); seq.observe("room", 50, true);
    expect(seq.next(true)).toBe(51);
    for(let i=0;i<20000;i++) expect(seq.next(false)).toBeNull();
    seq.observe("room", 50, false); expect(seq.next(true)).toBeNull();
    seq.observe("room", 50, true); expect(seq.next(true)).toBe(51);
  });
  it("resyncs server epoch, area/world/race instance, and backwards acknowledgements", () => {
    const seq = new InputSequence(); seq.observe("epoch:a", 100, true); seq.next(true);
    seq.observe("epoch:b", 100, true); expect(seq.next(true)).toBe(101);
    seq.observe("new-epoch:b", -1, true); expect(seq.next(true)).toBe(0);
    seq.observe("new-epoch:b", 50, true); seq.next(true);
    seq.observe("new-epoch:b", 0, true); expect(seq.next(true)).toBe(1);
  });
});
