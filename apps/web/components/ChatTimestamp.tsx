"use client";
import { useEffect, useState } from "react";
import { chatTime } from "../lib/chat-presentation";

export default function ChatTimestamp({ createdAt }: { createdAt: number }) {
  const [time, setTime] = useState<ReturnType<typeof chatTime>>(null);
  // Locale and timezone are chosen in the browser, avoiding SSR hydration differences.
  useEffect(() => { setTime(chatTime(createdAt)); }, [createdAt]);
  return time ? <time className="chat-timestamp" dateTime={time.iso} title={time.full} aria-label={`Sent ${time.full}`}>{time.short}</time> : null;
}
