import { notFound } from "next/navigation";
import { JoinForm } from "../../../components/join-form";
import { LanguageSwitch } from "../../../components/language-switch";
import { ButtonLink, Card, Logo, Money } from "../../../components/ui";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { draftByInvite } from "../../../lib/funds";
import { getLocale, getMessages } from "../../../lib/i18n/server";
import { invitationFor } from "../../../lib/invitation";

/** The invitation (spec, 9, screen 1). */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const draft = await draftByInvite(await getDb(), code);
  if (draft === null) notFound();
  const [locale, m] = await Promise.all([getLocale(), getMessages()]);
  const user = await currentUser();
  const invitation = invitationFor(draft, user?.id ?? null, m);
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
        {invitation.kind === "join" ? (
          <JoinForm code={code} loggedIn={user !== null} />
        ) : (
          <>
            <p role="status" className="font-semibold">
              {invitation.why}
            </p>
            {invitation.link && <ButtonLink href={invitation.link.href}>{invitation.link.label}</ButtonLink>}
          </>
        )}
      </Card>
      <p className="text-sm text-muted">{m.invitation.alreadyJoined(draft.members.map((member) => member.name).join(", "))}</p>
    </main>
  );
}
