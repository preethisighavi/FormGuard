// Downward caption stream. New cue drops in at the top (just under the video),
// holds >= MIN_DWELL, then older cues scroll down and fade off as the next arrives.
// A queue enforces the dwell so a burst of reps < 1s apart never skips a cue.

import { useEffect, useRef, useState } from "react";
import { C, FONT } from "../styles";

const MIN_DWELL = 1100; // ms — newest cue stays put at least this long
const MAX_VISIBLE = 4;

export interface Cue {
  id: number;
  text: string;
  tone?: "normal" | "warn" | "stop";
}

export function CaptionStream({ cue }: { cue: Cue | null }) {
  const [visible, setVisible] = useState<Cue[]>([]);
  const queue = useRef<Cue[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const lastShown = useRef(0);

  // enqueue distinct cues
  useEffect(() => {
    if (cue && !seen.current.has(cue.id)) {
      seen.current.add(cue.id);
      queue.current.push(cue);
    }
  }, [cue]);

  // pump: show one cue at a time, respecting MIN_DWELL
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      if (queue.current.length && now - lastShown.current >= MIN_DWELL) {
        const next = queue.current.shift()!;
        lastShown.current = now;
        setVisible((v) => [next, ...v].slice(0, MAX_VISIBLE));
      }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  const toneColor = (tone?: Cue["tone"]) =>
    tone === "stop" ? C.red : tone === "warn" ? C.amber : C.text;

  return (
    <div
      style={{
        position: "relative",
        height: 132,
        width: 520,
        maxWidth: "90vw",
        margin: "0 auto",
      }}
    >
      {visible.map((cue, i) => {
        const newest = i === 0;
        return (
          <div
            key={cue.id}
            style={{
              position: "absolute",
              top: i * 30,
              left: 0,
              right: 0,
              textAlign: "center",
              fontFamily: FONT,
              fontSize: newest ? 21 : 14,
              fontWeight: newest ? 600 : 500,
              color: newest ? toneColor(cue.tone) : C.muted,
              opacity: Math.max(0, 1 - i * 0.32),
              transform: `scale(${newest ? 1 : 0.94})`,
              transition:
                "top 420ms ease, opacity 420ms ease, transform 420ms ease, font-size 200ms",
              animation: newest ? "captionDrop 360ms ease-out" : undefined,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {newest ? `“${cue.text}”` : cue.text}
          </div>
        );
      })}
    </div>
  );
}
