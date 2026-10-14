import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ACCOUNT_CHANGED, type Balances, accountReader } from "../account-reader";
import { celoBrowserClient } from "./wallet";

/**
 * What the member's own account holds, read from the browser every `everyMs`, and again after a pass to pesos
 * (ACCOUNT_CHANGED, accountReader). `balances` is null until a first read; a read that fails keeps the last one and
 * sets `failed`.
 *
 * `changing` is true from the moment the pass is announced until a read made after it comes in, and `balances` is
 * then the one from before the pass: whoever offers an amount must not offer it. The hook can say it because it
 * sees both the announcement and the reads in order: accountReader drops any read begun before a change and makes no
 * routine look while one is awaited, so the first good read after the announcement is the one made after the pass.
 * A failed read doesn't end it.
 */
export function useAccountBalances(account: Address, everyMs: number): { balances: Balances | null; failed: boolean; changing: boolean } {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [failed, setFailed] = useState(false);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    const reader = accountReader(celoBrowserClient(), account, (read) => {
      if (read === null) {
        setFailed(true);
      } else {
        setBalances(read);
        setFailed(false);
        setChanging(false);
      }
    });
    void reader.look();
    const timer = setInterval(() => void reader.look(), everyMs);
    const onChange = (event: Event) => {
      const block = (event as CustomEvent<unknown>).detail;
      setChanging(true); // before anything else: the next render must already know the balances are old
      void reader.changed(typeof block === "bigint" ? block : undefined);
    };
    window.addEventListener(ACCOUNT_CHANGED, onChange);
    return () => {
      reader.stop();
      clearInterval(timer);
      window.removeEventListener(ACCOUNT_CHANGED, onChange);
    };
  }, [account, everyMs]);
  return { balances, failed, changing };
}
