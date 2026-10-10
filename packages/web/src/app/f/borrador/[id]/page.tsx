import { notFound, redirect } from "next/navigation";
import { DeployForm } from "../../../../components/deploy-form";
import { ShareLink } from "../../../../components/share-link";
import { Card, CardTitle, Logo } from "../../../../components/ui";
import { currentUser } from "../../../../lib/current-user";
import { getDb } from "../../../../lib/db/client";
import { env } from "../../../../lib/env";
import { MIN_MEMBERS, draftById } from "../../../../lib/funds";
import { safeNext } from "../../../../lib/safe-next";

/** A draft: who joined, the link to share, and for its creator, creating it in Celo (spec, 9). */
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (user === null) redirect(`/entrar?next=${encodeURIComponent(safeNext(`/f/borrador/${id}`))}`);
  const draft = await draftById(await getDb(), id);
  if (draft === null || !draft.members.some((m) => m.userId === user.id)) notFound();
  if (draft.status === "live" && draft.address) redirect(`/f/${draft.address}`);
  const isCreator = draft.creatorId === user.id;
  const canDeploy = isCreator && draft.members.length >= MIN_MEMBERS;
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
      <Logo />
      <h1 className="text-2xl font-bold [font-stretch:87%]">{draft.name}</h1>
      <Card className="grid gap-3">
        <CardTitle>Se sumaron</CardTitle>
        <ol className="grid">
          {draft.members.map((member, i) => (
            <li key={member.userId} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
              <span className="narrow w-6 text-xl font-bold text-num [font-stretch:75%]">{i + 1}</span>
              <span className={member.userId === user.id ? "marked font-semibold" : "font-semibold"}>
                {member.name}
                {member.userId === user.id ? " (vos)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="grid gap-3">
        <CardTitle>Compartí este link en el grupo</CardTitle>
        <ShareLink
          url={`${env().ORIGIN}/invitacion/${draft.inviteCode}`}
          fundName={draft.name}
          variant={canDeploy ? "secondary" : "primary"}
        />
      </Card>
      <Card className="grid gap-3">
        {canDeploy && <DeployForm fundId={draft.id} memberCount={draft.members.length} chosenVotes={draft.votesRequired} />}
        {isCreator && !canDeploy && <p className="text-muted">Cuando se sumen al menos 3 personas, vas a poder crear el fondo.</p>}
        {!isCreator && <p className="text-muted">Cuando estén todos, {draft.creatorName} crea el fondo y empieza a andar.</p>}
      </Card>
    </main>
  );
}
