"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useTransition } from "react";

type PageRefresh = {
  /** Asks the server for the screen again (router.refresh). */
  refresh: () => void;
  /** Runs `change` once no refresh is on its way: at once if none is, or when the last one lands. */
  afterRefresh: (change: () => void) => void;
};

const Refresh = createContext<PageRefresh | null>(null);

/**
 * A fund's pages refresh through here, so a panel's URL changes can wait for a refresh on its way (Panel, PanelLink).
 * Next's router holds them behind it anyway, and with two of them held (a closing and an opening) it reloads the
 * whole page once the refresh lands, or loses one of them: the chat's conversation goes with the reload.
 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refreshingNow = useRef(false);
  const waiting = useRef<Array<() => void>>([]);
  useLayoutEffect(() => {
    refreshingNow.current = refreshing;
    if (!refreshing) for (const change of waiting.current.splice(0)) change();
  }, [refreshing]);
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const afterRefresh = useCallback((change: () => void) => {
    if (refreshingNow.current) waiting.current.push(change);
    else change();
  }, []);
  const value = useMemo(() => ({ refresh, afterRefresh }), [refresh, afterRefresh]);
  return <Refresh value={value}>{children}</Refresh>;
}

/** The fund's refresh (RefreshProvider); outside a fund's pages, the router's own, with nothing to wait for. */
export function useRefresh(): PageRefresh {
  const router = useRouter();
  const fallback = useMemo(() => ({ refresh: () => router.refresh(), afterRefresh: (change: () => void) => change() }), [router]);
  return useContext(Refresh) ?? fallback;
}
