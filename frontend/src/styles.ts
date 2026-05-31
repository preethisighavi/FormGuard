// Design tokens. The ONLY palette (9 CSS vars from the plan) + Satoshi type scale.
// Inline-styles-only project: import these constants, do not add a CSS framework.

import type { CSSProperties } from "react";

export const C = {
  bg: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  muted: "#8b949e",

  green: "#3fb950",
  greenBg: "#132a1a",
  amber: "#e3b341",
  amberBg: "#2a1f0a",
  red: "#ff6b6b",
  redBg: "#2a0a0a",

  blue: "#58a6ff",
  purple: "#bc8cff",
} as const;

export const FONT = `'Satoshi', ui-sans-serif, system-ui, sans-serif`;

// Tabular numerals so the rep counter doesn't jitter-resize as it climbs.
export const TABULAR: CSSProperties = {
  fontFeatureSettings: '"tnum" 1',
  fontVariantNumeric: "tabular-nums",
};

export type FormState = "GREEN" | "YELLOW" | "RED";

// One source of truth for state -> color + label (reused from V1's FormStateRing map).
export const STATE: Record<
  FormState,
  { ring: string; bg: string; label: string }
> = {
  GREEN: { ring: C.green, bg: C.greenBg, label: "GOOD FORM" },
  YELLOW: { ring: C.amber, bg: C.amberBg, label: "EASING OFF" },
  RED: { ring: C.red, bg: C.redBg, label: "STOP" },
};

export const IDLE = { ring: C.border, bg: C.panel, label: "READY" };
