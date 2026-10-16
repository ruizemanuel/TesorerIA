import { type DraftSummary, MAX_MEMBERS } from "./funds";
import type { Messages } from "./i18n/messages";
import { type JoinState, MAX_OPEN_JOIN_REQUESTS } from "./join-requests";

export type Invitation =
  | { kind: "join" }
  // A live fund, to someone not in it (spec, 9.4): "Pedir sumarme", or "Pedir de nuevo" after `why` (it expired).
  | { kind: "request"; again: boolean; why?: string }
  | { kind: "closed"; why: string; link?: { href: string; label: string } };

/**
 * What the invitation offers (spec, 9, screen 1, and 9.4): "Sumarme" only where joinFund would take the person, so nobody
 * makes an account for a fund they can't join; on a live fund, asking to join and then where the request stands
 * (`join`, joinStateOf), unless the fund already has MAX_OPEN_JOIN_REQUESTS open requests from other people
 * (`othersWaiting`, openRequestsFromOthers): that is refused before any form, for the same reason. Otherwise why not,
 * and the way to the fund for someone already in it, in the language of `m`.
 */
export function invitationFor(
  fund: Pick<DraftSummary, "id" | "status" | "address" | "members">,
  viewerId: string | null,
  m: Messages,
  join: Pick<JoinState, "request" | "proposal"> = { request: null, proposal: null },
  othersWaiting = 0,
): Invitation {
  const isMember = viewerId !== null && fund.members.some((member) => member.userId === viewerId);
  const toFund = (href: string) => (isMember ? { link: { href, label: m.invitation.goToFund } } : {});
  switch (fund.status) {
    case "draft":
      return isMember || fund.members.length < MAX_MEMBERS ? { kind: "join" } : { kind: "closed", why: m.invitation.full };
    case "deploying":
      return { kind: "closed", why: m.invitation.beingCreated, ...toFund(`/f/borrador/${fund.id}`) };
    case "live": {
      if (isMember) return { kind: "closed", why: m.invitation.running, ...(fund.address === null ? {} : toFund(`/f/${fund.address}`)) };
      if (fund.members.length >= MAX_MEMBERS) return { kind: "closed", why: m.funds.liveFull };
      // A proposal made in time goes on in the contract even once the request stopped counting (spec, 9.4).
      if (join.proposal !== null) return { kind: "closed", why: m.invitation.proposed(join.proposal.proposer, join.proposal.votes, join.proposal.required) };
      if (join.request?.open) return { kind: "closed", why: m.invitation.requested };
      // Even with an expired request of their own: asking again would be refused all the same.
      if (othersWaiting >= MAX_OPEN_JOIN_REQUESTS) return { kind: "closed", why: m.funds.manyRequests };
      return join.request === null ? { kind: "request", again: false } : { kind: "request", again: true, why: m.invitation.expired };
    }
  }
}
