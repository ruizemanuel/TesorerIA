import Link from "next/link";
import { connection } from "next/server";
import { CreateFundForm } from "../../components/create-fund-form";
import { LanguageSwitch } from "../../components/language-switch";
import { Card, Logo } from "../../components/ui";
import { currentUser } from "../../lib/current-user";
import { getMessages } from "../../lib/i18n/server";

export default async function CreatePage() {
  await connection(); // it depends on who's asking, so it's never prerendered at build time (no settings there)
  const m = await getMessages();
  const user = await currentUser();
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <LanguageSwitch />
      </div>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">{m.create.title}</h1>
        <p className="text-muted">{m.create.lead}</p>
        <CreateFundForm loggedIn={user !== null} />
      </Card>
    </main>
  );
}
