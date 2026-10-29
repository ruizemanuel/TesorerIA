import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LanguageSwitch } from "../../components/language-switch";
import { LoginButton } from "../../components/login-button";
import { Card } from "../../components/ui";
import { currentUser } from "../../lib/current-user";
import { getLocale, getMessages } from "../../lib/i18n/server";
import { safeNext } from "../../lib/safe-next";
import { pageMetadata } from "../../lib/site-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return pageMetadata(m, locale, { title: m.login.title });
}

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  if (await currentUser()) redirect(target);
  const m = await getMessages();
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="narrow text-[20px] font-extrabold text-primary">
          TesorerIA
        </Link>
        <LanguageSwitch />
      </div>
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">{m.login.title}</h1>
        <p className="text-muted">{m.login.lead}</p>
        <LoginButton next={target} />
      </Card>
      <p className="text-sm text-muted">
        {m.login.firstTime(
          <Link className="font-bold text-primary" href="/crear">
            {m.login.createLink}
          </Link>,
        )}
      </p>
    </main>
  );
}
