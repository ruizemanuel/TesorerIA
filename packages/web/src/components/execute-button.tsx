"use client";

import type { Address } from "viem";
import { useMessages } from "../lib/i18n/client";
import { executeCalls } from "../lib/vote";
import { OperationButton } from "./operation-button";

/**
 * Ejecutar, on a proposal that has its votes but didn't run with the last one (spec, 7.3: anyone may execute it).
 * One operation, confirmed with the passkey; the refreshed page then says "Se aprobó.".
 */
export function ExecuteButton({ fund, proposalId }: { fund: Address; proposalId: string }) {
  const m = useMessages();
  return (
    <OperationButton calls={() => executeCalls({ fund, proposalId: BigInt(proposalId) })} operation={{ kind: "execute", fund }} label={m.execute.button} />
  );
}
