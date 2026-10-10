import { notFound } from "next/navigation";
import { JoinForm } from "../../../components/join-form";
import { ButtonLink, Card, Logo, Money } from "../../../components/ui";
import { currentUser } from "../../../lib/current-user";
import { getDb } from "../../../lib/db/client";
import { draftByInvite } from "../../../lib/funds";
import { invitationFor } from "../../../lib/invitation";

/** The invitation (spec, 9, screen 1). */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const draft = await draftByInvite(await getDb(), code);
  if (draft === null) notFound();
  const user = await currentUser();
  const invitation = invitationFor(draft, user?.id ?? null);
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
      <Logo />
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">
          {draft.creatorName} te invitó a <em>{draft.name}</em>
        </h1>
        <p>
          Cada uno pone <Money units={draft.weeklyFee} /> por semana. El agente devuelve hasta <Money units={draft.weeklyCap} /> por semana por{" "}
          {draft.agreedExpense}. Todo lo demás se vota. Nadie puede cambiar esto solo, ni el agente.
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
      <p className="text-sm text-muted">Ya se sumaron: {draft.members.map((m) => m.name).join(", ")}.</p>
    </main>
  );
}
