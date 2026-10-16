"use client";

import type { Address } from "viem";
import { useMessages } from "../lib/i18n/client";
import { addMemberCalls } from "../lib/vote";
import { OperationButton } from "./operation-button";

/**
 * Proponer sumarlo, on someone who asked to join (spec, 9.4): one operation, confirmed with the passkey, that proposes
 * adding their account and counts as the proposer's vote. The refreshed page then shows the proposal instead.
 */
export function ProposeMemberButton({ fund, account }: { fund: Address; account: Address }) {
  const m = useMessages();
  return <OperationButton calls={() => addMemberCalls({ fund, account })} operation={{ kind: "propose", fund }} label={m.proposeMember.button} />;
}
