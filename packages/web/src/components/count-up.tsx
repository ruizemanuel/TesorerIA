"use client";

import { useEffect, useState } from "react";
import { WARS_UNIT, formatPesos } from "../lib/format";

/** The one moment (spec, 9.2): the balance counts up to its new value after your contribution, in ~600 ms. */
export function CountUp({ from, to }: { from: bigint; to: bigint }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
      setValue(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / 600);
      const eased = 1 - (1 - progress) ** 3;
      // Whole pesos on the way (cents flickering by would look like noise), the exact amount at the end.
      const now = from + ((to - from) * BigInt(Math.round(eased * 1000))) / 1000n;
      setValue(progress < 1 ? now - (now % WARS_UNIT) : to);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to]);
  return <>{formatPesos(value)}</>;
}
