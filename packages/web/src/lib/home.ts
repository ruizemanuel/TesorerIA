import { type Address, isAddress, isAddressEqual } from "viem";
import type { Messages } from "./i18n/messages";

/** The last fund a member opened (spec, 9.4 C): RememberFund sets it, and the home page goes back to it. */
export const LAST_FUND_COOKIE = "last_fund";
/** A year, in seconds, like the language cookie. */
export const LAST_FUND_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type FundRow = { id: string; status: "draft" | "deploying" | "live"; address: string | null };

/** Whether `a` and `b` are the same address, in any letter case. False for anything that isn't one. */
function sameAddress(a: string | null | undefined, b: string): boolean {
  return a != null && isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && isAddressEqual(a, b);
}

/** Where a fund of yours lives: its inicio once it's live, its draft's page until then (a fund being created too). */
function fundHref(fund: FundRow): string {
  return fund.status === "live" && fund.address !== null ? `/f/${fund.address}` : `/f/borrador/${fund.id}`;
}

/**
 * Where the home page takes someone logged in (spec, 9.4 C), or null to stay on it: the last fund they opened if
 * they're still in it, else their first live fund, their first draft, or the invitation of a request of theirs, open
 * or expired: `requests` is newest first, so an open one goes first. `lastFund` is the cookie, as the browser sent it:
 * read, never trusted.
 */
export function homeTarget({
  funds,
  lastFund,
  requests,
}: {
  funds: readonly FundRow[];
  lastFund: string | undefined;
  requests: readonly { inviteCode: string }[];
}): string | null {
  const live = funds.filter((fund) => fund.status === "live" && fund.address !== null);
  const fund = live.find((f) => lastFund !== undefined && sameAddress(f.address, lastFund)) ?? live[0] ?? funds[0];
  if (fund !== undefined) return fundHref(fund);
  const [request] = requests;
  return request === undefined ? null : `/invitacion/${request.inviteCode}`;
}

/** A row of Tus fondos: `href` is null for the fund on screen, and `tag` is what the row says after the name. */
export type YourFund = { key: string; name: string; href: string | null; tag: "here" | "draft" | "requested" | null };

/**
 * Tus fondos, in Tu cuenta (spec, 9.4 C): your funds as fundsOf lists them (live ones first), with `current` marked
 * and no link, then your open requests to join other funds, each linked to its invitation.
 */
export function yourFunds({
  funds,
  requests,
  current,
}: {
  funds: readonly (FundRow & { name: string })[];
  requests: readonly { fundId: string; name: string; inviteCode: string }[];
  current: Address;
}): YourFund[] {
  const rows = funds.map((fund): YourFund => {
    if (fund.status !== "live" || fund.address === null) return { key: fund.id, name: fund.name, href: fundHref(fund), tag: "draft" };
    const here = sameAddress(fund.address, current);
    return { key: fund.id, name: fund.name, href: here ? null : fundHref(fund), tag: here ? "here" : null };
  });
  // Right after a vote lets them in, the request can outlive the membership for a moment: the fund is listed already.
  const asked = requests
    .filter((request) => !funds.some((fund) => fund.id === request.fundId))
    .map((request): YourFund => ({ key: `request:${request.fundId}`, name: request.name, href: `/invitacion/${request.inviteCode}`, tag: "requested" }));
  return [...rows, ...asked];
}

/** What a row of Tus fondos says after the fund's name, behind a middle dot, or null when it has no tag. */
export function fundTag(row: YourFund, m: Messages): string | null {
  return row.tag === null ? null : ` · ${m.account.fundTags[row.tag]}`;
}
