"use client";

import { useEffect, useRef, useState } from "react";
import { countUpStart } from "../lib/count-up";
import { WARS_UNIT, formatPesos } from "../lib/format";
import { useLocale } from "../lib/i18n/client";

/** The one moment (spec, 9.2): the balance counts up to its new value after your contribution, in ~600 ms, once. */
export function CountUp({ from, to }: { from: bigint; to: bigint }) {
  const locale = useLocale();
  const [value, setValue] = useState(from);
  // Set when an animation ends, not when it starts: one cut short (React's dev double run, a new `to`) plays again.
  const played = useRef(false);
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = countUpStart({ played: played.current, from, to, reducedMotion });
    if (start === null) {
      setValue(to);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / 600);
      const eased = 1 - (1 - progress) ** 3;
      // Whole pesos on the way (cents flickering by would look like noise), the exact amount at the end.
      const now = start + ((to - start) * BigInt(Math.round(eased * 1000))) / 1000n;
      setValue(progress < 1 ? now - (now % WARS_UNIT) : to);
      if (progress < 1) frame = requestAnimationFrame(step);
      else played.current = true;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to]);
  return <>{formatPesos(value, locale)}</>;
}
