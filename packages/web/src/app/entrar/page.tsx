import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginButton } from "../../components/login-button";
import { Card } from "../../components/ui";
import { currentUser } from "../../lib/current-user";

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await currentUser()) redirect(safeNext);
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-10">
      <Link href="/" className="narrow text-[20px] font-extrabold text-primary">
        TesorerIA
      </Link>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">Entrá a tu fondo</h1>
        <p className="text-muted">Usá la passkey que creaste cuando te sumaste. Tu teléfono te la va a pedir.</p>
        <LoginButton next={safeNext} />
      </Card>
      <p className="text-sm text-muted">
        ¿Es tu primera vez? Entrá con el link de invitación que te pasaron, o{" "}
        <Link className="font-bold text-primary" href="/crear">
          creá un fondo
        </Link>
        .
      </p>
    </main>
  );
}
