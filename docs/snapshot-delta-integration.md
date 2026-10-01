# Complete snapshots over a delta transport

`packages/contracts/src/snapshot-delta.ts` is a transport-independent codec. It leaves `RoomSnapshot` complete and unchanged. The decoder returns that same complete snapshot, including every authoritative field and all human roster/minimap positions. Only the wire representation changes. No entity simulation, monster targeting, or authoritative state is removed by this codec.

## Public API

```ts
import {
  SnapshotDeltaEncoder, applySnapshotFrame,
  type SnapshotState,
} from '../../packages/contracts/src/snapshot-delta'; // adjust relative path

// One encoder per admitted connection, never shared across recipients.
const encoder = new SnapshotDeltaEncoder<RoomSnapshot>();
const frame = encoder.encode(completeRecipientSnapshot, Date.now());
client.send('snapshot.delta', frame);

// Keep this codec state independent of React/UI-derived state.
let state: SnapshotState<RoomSnapshot> | undefined;
const result = applySnapshotFrame(state, receivedFrame, admittedEpoch);
if (result.ok && result.applied) {
  state = result.state;
  acceptCompleteSnapshot(result.state.snapshot); // existing full-snapshot handler
} else if (!result.ok) {
  requestRateLimitedFullSnapshot();
}
```

`createSnapshotFull(snapshot, seq)` and `createSnapshotDelta(previous, next, baseSeq, seq)` are available for stateless callers/tests. The stateful encoder is preferable for the server: it detaches and freezes its remembered base before the room mutates its next simulation tick. The encoder's sequence is independent of `serverTime` and any existing room/event sequence. It starts at 1 and requires safe positive integers.

The encoder sends a full frame initially, at least every 2 seconds while snapshots are being sent, when forced, when `epoch`/`worldRevision`/`instanceId` changes, or when its clock moves backward. `encode(snapshot, now, true)` forces a full frame without resetting its sequence. `reset()` is for a new connection lifecycle, not an in-place resync. The retained base is one bounded snapshot per recipient, not a historical frame log.

## Root-owned integration steps

1. Keep the existing `snapshot` message for older clients. Add `snapshot.delta-ready` with a strictly checked `{v: 1}` payload on the current admitted game socket. Verify `clientsByUser.get(admission.userId) === client` and current membership before enabling it. Store the encoder by connection/client, not just by user ID. A replaced tab must never enable or reset its replacement's stream.
2. Until that opt-in, send the existing complete `snapshot`. Once opted in, send encoder frames on `snapshot.delta`; its first frame is full. Register the new client handler before sending opt-in. Reconnecting clients opt in again and create fresh codec state. Clear encoder state on leave/replacement/disposal.
3. Route reconstructed complete snapshots into the existing accepted-snapshot function. Keep sequence state in a closure/ref associated with that exact connection. Continue the existing `room.current === connected` guard. Do not update codec state from derived React state, chat append handlers, client prediction, or other UI operations.
4. Pin the decoder to the connection's trusted admitted epoch when available. By default it pins to the previous codec state's epoch. For a newly admitted epoch, clear state or explicitly pass that new epoch. A delta can never initialize a base. An old delayed full packet cannot switch an established stream back to another epoch.
5. On `!result.ok`, keep the last complete snapshot and request `snapshot.resync` at most once per second while waiting for a full. The server verifies the current admitted socket/membership, rate limits the request, and marks the next scheduled frame `forceFull`. Do not call `reset()` on the server for an in-place resync, and do not accept partial data. The periodic full also heals a missed request.
6. Test legacy client/full mode, opt-in before/after the first snapshot, missed delta/full recovery, replaced tabs, reconnects, world/interior/race transitions, and client handler cleanup. User data and the gameplay command protocol need no migration. Rollback retains legacy full clients; deploy the server before relying on opt-in.

## Representation and validation

Full envelopes are `{v: 1, kind: 'full', epoch, seq, snapshot}`. Delta envelopes are `{v: 1, kind: 'delta', epoch, baseSeq, seq, changes?, entities?, survival?}`. `seq` must equal `baseSeq + 1`, and the base must match the exact accepted recipient state. Older/replayed sequences are no-ops. Missing base, unexpected epoch, or invalid data returns `{ok: false, resync: true, reason}` without mutating the prior state.

`players`, `members`, `npcs`, and `survival.players` use unique string IDs. Changed entities use compact `[id, setFields, removedFieldNames?]` tuples. Additions include the complete entity. The exact final ID order accompanies membership/order changes; unchanged order is inherited. All other changed fields, including climate, arrays, chat, race and nested metadata, are transmitted whole only when changed. There is no numerical quantization or position rounding. An explicitly present `undefined` property is distinct from an absent property. Object key insertion order is not a gameplay contract; array order and value/presence are preserved.

The current Colyseus MessagePack transport preserves `undefined`, including array values. Raw JSON serialization does not, so this codec must not be routed through JSON without adding an explicit representation for undefined first. MessagePack itself normalizes negative zero to zero; the benchmark compares reconstructed values to the original full **wire** snapshot for that reason. NaN, infinities, functions, symbols, bigint, dates, maps, cycles, getters, sparse arrays and exotic prototypes are rejected rather than silently converted.

Decoder input is detached before use, never merged unsafely. `__proto__`, `constructor`, and `prototype` are rejected as property names at every depth; entity IDs remain ordinary strings in a `Map`, so an ID with one of those values is harmless. Conflicting updates/removals, ID changes, unknown/duplicate IDs, incomplete order arrays, protected-field patches, and extra envelope/patch keys are rejected. Bounds cover individual packets **and the reconstructed state**, so a succession of small patches cannot grow an unbounded snapshot. Frozen unchanged branches share immutable data; cached size accounting is weakly held. Limits are exported and tested (depth 24, 50,000 nodes, 4,096 array entries, 512 entities per keyed array, 256 object fields, 65,536 characters/string and 1,048,576 total string characters).

## Validation and measurement

The unit suite covers repeated eight-human transitions; explicit undefined/removal; NPC lifecycle, ordering, interest removal and return; inventory changes; detached mutable-room inputs; actual installed MessagePack round trips; independent recipients; periodic/forced full frames; epoch and scope transitions; replay/drop/resync; malformed sequence/operation data; pollution/getter/cycle attacks; and per-packet plus cumulative bounds.

```sh
node node_modules/vitest/vitest.mjs run packages/contracts/test/snapshot-delta.test.ts
node --expose-gc --import tsx tests/bench/expanded-room-benchmark.ts --mode integrated --seconds 300 --warmup 15 --scenario both --delta --out /tmp/expanded-room-delta.json
```

With `--delta`, the room harness compares baseline full and candidate delta encoding on the **same actual snapshots**. Every candidate frame passes through actual Colyseus MessagePack framing, is decoded/applied, and is deep-compared against the decoded baseline full frame. Both initial and two-second periodic full frames count toward delta bandwidth. Client decoding and assertions are excluded from server CPU estimates. Both encodings share one process, so JIT/allocator/GC effects still interact. This measures synthetic server work and protocol bytes, not browser rendering, network delivery, or production memory capacity.

## Final integrated comparison (2026-10-01)

The recorded `expanded-room-delta-final.json` in the parent task directory used the real configured 144×112 world, 730 immutable solids, 25 NPCs, eight admitted humans, and five measured minutes per scenario after 15 seconds of warmup. Every one of 96,040 frames reconstructed and deep-compared successfully. Periodic full frames are included below.

| Metric | Eight spread | Eight at camp |
| --- | ---: | ---: |
| Full / delta mean actual frame bytes | 14,699 / 1,850 | 10,548 / 1,486 |
| Byte reduction | 87.41% | 85.91% |
| Full / delta aggregate bytes/s at 20 Hz | 2,351,856 / 296,067 | 1,687,629 / 237,759 |
| Full baseline / delta candidate frame CPU p99, ms | 1.465 / 2.649 | 1.202 / 2.141 |
| Delta encode p99, ms/client | 0.370 | 0.216 |
| MessagePack decode + delta apply p99, ms/client | 0.236 | 0.139 |
| Reconstructed frames | 48,040 | 48,000 |
| Periodic/initial full frames | 1,200 | 1,200 |

All 25 NPCs moved in both scenarios; at most 24 aggregate NPC path points were retained, with at most one NPC search per update. Spread humans were about 119 tiles apart on average and 7.98 of eight were outside camp on average. The final run activated the clown and werewolf; the previous integrated run activated the clown and mimic. No claim that all monsters activate in every stochastic five-minute run is made.

The delta trades additional server CPU for considerably lower bandwidth. One camp candidate frame reached 21.25 ms, and client decode/apply maximum outliers reached 19–28 ms; favorable p99 values do not prove a 60fps renderer or absence of pauses. The comparison-process sampled RSS peaked at 366.55 MiB (spread) / 390.77 MiB (camp), with 4.71 / 0.56 MiB retained heap growth after GC. That process includes **both** full/delta encoding, eight receiver decoders, all-frame assertions, SQLite, and timing reservoirs. It is not production-server RSS, nor proof of spare capacity on a 512 MiB deployment. Server integration, actual WebSocket delivery/recovery, browser rendering, and deployment memory still require their respective checks.
