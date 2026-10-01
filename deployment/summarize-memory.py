"""Summarize only measurements, never synthetic credentials or SQLite contents.

python3 deployment/summarize-memory.py CLIENT_REPORT SERVER_LOG OUTPUT
"""
import json
import sys
from pathlib import Path

client = json.loads(Path(sys.argv[1]).read_text())
samples = []
ready = None
for line in Path(sys.argv[2]).read_text().splitlines():
    try:
        item = json.loads(line)
    except json.JSONDecodeError:
        continue
    if item.get("kind") == "sample":
        samples.append(item)
    elif item.get("kind") == "ready":
        ready = item
assert samples, "No cgroup measurements captured"
assert ready, "Server runtime metadata was not captured"


def fields(value):
    return {line.split()[0]: int(line.split()[1]) for line in value.splitlines()}


def mib(value):
    return round(value / 1024**2, 2)


def stats(rows):
    assert rows
    first, last = rows[0], rows[-1]
    seconds = (last["timestamp"] - first["timestamp"]) / 1000
    cpu_usec = sum(last["cpu"].values()) - sum(first["cpu"].values())
    return {
        "samples": len(rows),
        "maxContainerCurrentMiB": mib(max(int(row["cgroupCurrent"]) for row in rows)),
        "maxProcessRssMiB": mib(max(row["memory"]["rss"] for row in rows)),
        "maxHeapUsedMiB": mib(max(row["memory"]["heapUsed"] for row in rows)),
        "firstContainerCurrentMiB": mib(int(first["cgroupCurrent"])),
        "lastContainerCurrentMiB": mib(int(last["cgroupCurrent"])),
        "meanCpuPercentOfOneCore": round(cpu_usec / 1e6 / seconds * 100, 2) if seconds else None,
        "maxEventLoopDelayMs": round(max(row["eventLoopMaxMs"] for row in rows), 2),
    }


limit = int(samples[-1]["cgroupMax"])
peak = max(int(row["cgroupPeak"]) for row in samples)
events = fields(samples[-1]["cgroupEvents"])
assert limit == 512 * 1024**2, "The expected hard memory cap was not applied"
assert int(samples[-1]["cgroupSwapMax"]) == 0, "Swap was not disabled"
assert samples[-1]["cpuMax"] == "100000 100000", "Expected one-core CPU quota"
result = {
    **client,
    "runtime": {"node": ready["node"], "platform": ready["platform"], "arch": ready["arch"], "memoryLimitMiB": mib(limit), "swapLimitMiB": 0, "cpuQuotaCores": 1},
    "memory": {**stats(samples), "kernelRecordedPeakMiB": mib(peak), "peakPercentOfLimit": round(peak / limit * 100, 2), "remainingAtPeakMiB": mib(limit - peak), "limitEvents": events},
    "phases": [{**phase, "resources": stats([row for row in samples if phase["startTimestamp"] <= row["timestamp"] <= phase["endTimestamp"]])} for phase in client["phases"]],
}
assert not any(events.get(name, 0) for name in ["max", "oom", "oom_kill", "oom_group_kill"]), "Memory-limit pressure or OOM occurred"
Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
