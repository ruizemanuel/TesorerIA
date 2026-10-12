"use client";

import { USDT, WARS } from "@tesoreria/agent";
import { useEffect, useState } from "react";
import { type Address, erc20Abi } from "viem";
import { celoBrowserClient } from "../lib/client/wallet";
import { heldAmounts } from "../lib/format";

const LOOK_EVERY_MS = 30_000;

/**
 * "En tu cuenta tenés $ 1.016,10.": what reached the member's own account and isn't in the fund, so money that
 * arrived from Ripio or an exchange doesn't look lost before its Aportar. No "sin aportar": the agent's
 * reimbursements land there too, and those are the member's to keep. Nothing while it reads, if it can't, or if the
 * account is empty.
 */
export function AccountHolding({ account }: { account: Address }) {
  const [amounts, setAmounts] = useState<string[]>([]);
  useEffect(() => {
    const client = celoBrowserClient();
    let live = true;
    const look = async () => {
      try {
        const [wars, usdt] = await Promise.all([
          client.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        ]);
        if (live) setAmounts(heldAmounts({ wars, usdt }));
      } catch {
        // A convenience line: a failed read leaves what it said before.
      }
    };
    look();
    const timer = setInterval(look, LOOK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [account]);
  if (amounts.length === 0) return null;
  return (
    <p className="mt-1 text-sm text-muted">
      En tu cuenta tenés{" "}
      {amounts.map((amount, i) => (
        <span key={amount}>
          {i > 0 && " y "}
          <span className="money font-semibold text-ink">{amount}</span>
        </span>
      ))}
      .
    </p>
  );
}
