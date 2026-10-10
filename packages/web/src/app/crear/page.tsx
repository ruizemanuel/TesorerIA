import Link from "next/link";
import { connection } from "next/server";
import { CreateFundForm } from "../../components/create-fund-form";
import { Card, Logo } from "../../components/ui";
import { currentUser } from "../../lib/current-user";

export default async function CreatePage() {
  await connection(); // it depends on who's asking, so it's never prerendered at build time (no settings there)
  const user = await currentUser();
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
      <Link href="/">
        <Logo />
      </Link>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">Armá el fondo del grupo</h1>
        <p className="text-muted">
          Después te damos un link para pasar por WhatsApp. Cuando se sumen al menos 3, lo creás. Los votos necesarios se eligen en ese momento.
        </p>
        <CreateFundForm loggedIn={user !== null} />
      </Card>
    </main>
  );
}
