"use client";

import { useEffect, useRef } from "react";
import type { Address } from "viem";
import { celoBrowserClient } from "../lib/client/wallet";
import { LOOK_EVERY_MS, checkForNews } from "../lib/live";
import { readPanel } from "../lib/panel";
import { useRefresh } from "./refresh-provider";

/**
 * Keeps a fund's screen current (spec, 9.2) without asking the server for nothing. While the page is visible, the
 * browser reads the fund's logs every LOOK_EVERY_MS after the block the screen was read at (`block`), and refreshes
 * the screen from the server only when there's one, or when the page comes back after a while (checkForNews).
 * Nothing is read while a panel is open: its own actions refresh the page, and a refresh under it would redraw it
 * mid-use. The first look after it closes catches up. Renders nothing.
 */
export function LiveFund({ fund, block }: { fund: Address; block: bigint }) {
  const { refresh } = useRefresh();
  const shown = useRef(block);
  useEffect(() => {
    shown.current = block;
  }, [block]);

  useEffect(() => {
    const client = celoBrowserClient();
    let live = true;
    let busy = false;
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    let cameBack: number | undefined; // how long the page was away, until a look takes it into account

    const look = async () => {
      if (busy || document.visibilityState !== "visible" || readPanel(new URLSearchParams(window.location.search)) !== null) return;
      busy = true;
      const cameBackAfterMs = cameBack;
      cameBack = undefined;
      try {
        const news = await checkForNews({
          shown: shown.current,
          cameBackAfterMs,
          latestBlock: () => client.getBlockNumber(),
          logsBetween: (range) => client.getLogs({ address: fund, ...range }),
        });
        if (news && live) refresh();
      } catch {
        // The next look tries again, and still knows the page came back.
        cameBack ??= cameBackAfterMs;
      } finally {
        busy = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null) cameBack = Date.now() - hiddenAt;
      hiddenAt = null;
      void look();
    };

    const timer = setInterval(() => void look(), LOOK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fund, refresh]);

  return null;
}
