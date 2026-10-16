"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { LAST_FUND_COOKIE, LAST_FUND_COOKIE_MAX_AGE } from "../lib/home";

/**
 * Remembers the fund on screen as the last one this member opened (spec, 9.4 C), for the home page to go back to. Only
 * the address, which is public, for a year; it shows nothing.
 */
export function RememberFund({ fund }: { fund: Address }) {
  useEffect(() => {
    try {
      document.cookie = `${LAST_FUND_COOKIE}=${fund}; path=/; max-age=${LAST_FUND_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      // A page where cookies can't be set (a sandboxed frame): the home page falls back to the first live fund.
    }
  }, [fund]);
  return null;
}
