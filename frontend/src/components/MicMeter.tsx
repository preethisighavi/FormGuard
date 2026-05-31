// Live "it hears me" indicator. Taps the same mic MediaStream we capture for the
// coach via a Web Audio AnalyserNode and renders amplitude bars. If there's no
// stream (mic denied), it shows calm idle bars rather than looking dead.

import { useEffect, useRef, useState } from "react";
import { C } from "../styles";

const BARS = 7;

export function MicMeter({
  stream,
  active,
}: {
  stream: MediaStream | null;
  active: boolean;
}) {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.15));
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    src.connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(bins);
      const step = Math.floor(bins.length / BARS);
      const next: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += bins[i * step + j];
        next.push(Math.min(1, sum / step / 180 + 0.12));
      }
      setLevels(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      src.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);

  // gentle idle shimmer when there's no live stream
  useEffect(() => {
    if (stream) return;
    const t = window.setInterval(() => {
      setLevels(
        Array.from(
          { length: BARS },
          (_, i) => 0.18 + 0.1 * Math.abs(Math.sin(Date.now() / 600 + i)),
        ),
      );
    }, 120);
    return () => window.clearInterval(t);
  }, [stream]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 16, opacity: active ? 1 : 0.5 }} aria-hidden>
        🎙
      </span>
      <div
        style={{ display: "flex", alignItems: "center", gap: 3, height: 22 }}
      >
        {levels.map((l, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: `${Math.round(4 + l * 18)}px`,
              borderRadius: 2,
              background: active ? C.green : C.muted,
              transition: "height 90ms linear",
            }}
          />
        ))}
      </div>
    </div>
  );
}
