import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinForm } from "../../../components/join-form";
import { LanguageSwitch } from "../../../components/language-switch";
import { ButtonLink, Card, Logo, Money } from "../../../components/ui";
import { celoClient } from "../../../lib/chain";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { draftByInvite } from "../../../lib/funds";
import { getLocale, getMessages } from "../../../lib/i18n/server";
import { invitationFor } from "../../../lib/invitation";
import { NO_JOIN, joinStateOf, openRequestsFromOthers } from "../../../lib/join-requests";

/** The link preview names the fund it invites to (spec, 9.6): it's what the group sees in the chat. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const draft = await draftByInvite(await getDb(), (await params).code);
  if (draft === null) return {};
  const m = await getMessages();
  return { title: m.meta.invitationTitle(draft.name), description: m.meta.invitationDescription };
}

/** The invitation (spec, 9, screen 1), and on a live fund, asking to join it and where that stands (spec, 9.4). */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = await getDb();
  let draft = await draftByInvite(db, code);
  if (draft === null) notFound();
  const [locale, m] = await Promise.all([getLocale(), getMessages()]);
  const user = await currentUser();
  const join = user === null ? NO_JOIN : await joinStateOf(db, celoClient(), draft, user, m);
  // Admitted just now: the fund lists them, and the invitation takes them to it.
  if (join.admitted) draft = (await draftByInvite(db, code)) ?? draft;
  // Only a live fund has requests; whoever the viewer is, the cap is on the other people's (invitationFor).
  const othersWaiting = draft.status === "live" ? await openRequestsFromOthers(db, draft.id, user?.id ?? null) : 0;
  const invitation = invitationFor(draft, user?.id ?? null, m, join, othersWaiting);
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
      <div className="flex items-center justify-between">
        <Logo />
        <LanguageSwitch />
      </div>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">{m.invitation.title(draft.creatorName, <em>{draft.name}</em>)}</h1>
        <p>
          {m.invitation.rules(
            <Money units={draft.weeklyFee} locale={locale} />,
            <Money units={draft.weeklyCap} locale={locale} />,
            draft.agreedExpense,
          )}
        </p>
        {invitation.kind === "closed" ? (
          <>
            <p role="status" className="font-semibold">
              {invitation.why}
            </p>
            {invitation.link && <ButtonLink href={invitation.link.href}>{invitation.link.label}</ButtonLink>}
          </>
        ) : (
          <>
            {invitation.kind === "request" && invitation.why && (
              <p role="status" className="font-semibold">
                {invitation.why}
              </p>
            )}
            <JoinForm
              code={code}
              loggedIn={user !== null}
              label={invitation.kind === "join" ? m.invitation.join : invitation.again ? m.invitation.requestAgain : m.invitation.request}
            />
          </>
        )}
      </Card>
      <p className="text-sm text-muted">{m.invitation.alreadyJoined(draft.members.map((member) => member.name).join(", "))}</p>
    </main>
  );
}
