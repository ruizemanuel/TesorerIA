import { type DraftSummary, MAX_MEMBERS } from "./funds";
import type { Messages } from "./i18n/messages";

export type Invitation = { kind: "join" } | { kind: "closed"; why: string; link?: { href: string; label: string } };

/**
 * What the invitation offers (spec, 9, screen 1): "Sumarme" only where joinFund would take the person, so nobody
 * makes an account for a fund they can't join. Otherwise why not, and the way to the fund for someone already in it,
 * said in the language of `m`.
 */
export function invitationFor(
  fund: Pick<DraftSummary, "id" | "status" | "address" | "members">,
  viewerId: string | null,
  m: Messages,
): Invitation {
  const isMember = viewerId !== null && fund.members.some((member) => member.userId === viewerId);
  const toFund = (href: string) => (isMember ? { link: { href, label: m.invitation.goToFund } } : {});
  switch (fund.status) {
    case "draft":
      return isMember || fund.members.length < MAX_MEMBERS ? { kind: "join" } : { kind: "closed", why: m.invitation.full };
    case "deploying":
      return { kind: "closed", why: m.invitation.beingCreated, ...toFund(`/f/borrador/${fund.id}`) };
    case "live":
      return { kind: "closed", why: m.invitation.running, ...(fund.address === null ? {} : toFund(`/f/${fund.address}`)) };
  }
}
