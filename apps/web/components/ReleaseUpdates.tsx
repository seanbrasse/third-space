"use client";
import { useId, useRef, useState } from "react";
import { formatReleaseDate, type PublishedRelease } from "../lib/release-history";
import styles from "./release-updates.module.css";
const PAGE_SIZE = 6;

export default function ReleaseUpdates({ entries }: { entries: PublishedRelease[] }) {
  const [open, setOpen] = useState(false), [visible, setVisible] = useState(PAGE_SIZE);
  const id = useId(), toggle = useRef<HTMLButtonElement>(null);
  const remaining = Math.max(0, entries.length - visible);
  return <section className={styles.updates} data-game-input="off" onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus({ preventScroll: true });
    }
  }}>
    <button ref={toggle} className={styles.toggle} id={`${id}-toggle`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}>
      Updates <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    <div id={id} role="region" aria-labelledby={`${id}-toggle`} hidden={!open} className={styles.panel}>
      <h2>What&apos;s changed</h2>
      <p className={styles.intro}>The story of Third Space, newest first. Everyone can read these updates.</p>
      {entries.length > 0 ? <>
        <p className={styles.note}>History starts with the earliest recorded prototype on 30 September 2026. Older entries use source or merge dates; these are not release times. Verified release dates are labeled “Released”. Exact times use UTC.</p>
        <ol className={styles.list}>
          {entries.slice(0, visible).map(entry => <li key={entry.id}>
            <article>
              <time dateTime={entry.date}>{formatReleaseDate(entry)}</time>
              <h3>{entry.title}</h3>
              <ul>{entry.changes.map(change => <li key={change}>{change}</li>)}</ul>
            </article>
          </li>)}
        </ol>
        <p className={styles.count} role="status">Showing {Math.min(visible, entries.length)} of {entries.length} updates.</p>
        {entries.length > PAGE_SIZE && <button className={styles.older} aria-disabled={remaining === 0} onClick={() => { if (remaining > 0) setVisible(current => current + PAGE_SIZE); }}>{remaining > 0 ? `Show older updates (${remaining} remaining)` : "All updates shown"}</button>}
        {remaining === 0 && <p className={styles.note}>You&apos;ve reached the earliest available history.</p>}
      </> : <p className={styles.note}>No published updates yet. Check back after the next release.</p>}
    </div>
  </section>;
}
