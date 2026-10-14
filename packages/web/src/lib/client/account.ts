import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ACCOUNT_CHANGED, type Balances, accountReader } from "../account-reader";
import { celoBrowserClient } from "./wallet";

/**
 * What the member's own account holds, read from the browser every `everyMs`, and again after a pass to pesos
 * (ACCOUNT_CHANGED, accountReader). `balances` is null until a first read; a read that fails keeps the last one and
 * sets `failed`. Each good read is a new object, even with the same amounts: a panel can tell a read made after
 * something it did from one before it.
 */
export function useAccountBalances(account: Address, everyMs: number): { balances: Balances | null; failed: boolean } {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const reader = accountReader(celoBrowserClient(), account, (read) => {
      if (read === null) {
        setFailed(true);
      } else {
        setBalances(read);
        setFailed(false);
      }
    });
    void reader.look();
    const timer = setInterval(() => void reader.look(), everyMs);
    const onChange = (event: Event) => {
      const block = (event as CustomEvent<unknown>).detail;
      void reader.changed(typeof block === "bigint" ? block : undefined);
    };
    window.addEventListener(ACCOUNT_CHANGED, onChange);
    return () => {
      reader.stop();
      clearInterval(timer);
      window.removeEventListener(ACCOUNT_CHANGED, onChange);
    };
  }, [account, everyMs]);
  return { balances, failed };
}
