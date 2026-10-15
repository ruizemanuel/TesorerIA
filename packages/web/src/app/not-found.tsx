import { LanguageSwitch } from "../components/language-switch";
import { ButtonLink, Card, Logo } from "../components/ui";
import { getMessages } from "../lib/i18n/server";

/**
 * Every `notFound()` of the app ends here, including a fund the person isn't part of: the page never says
 * whether the fund exists, only that this link leads nowhere for them.
 */
export default async function NotFound() {
  const m = await getMessages();
  return (
    <main className="mx-auto grid max-w-[560px] gap-4 p-4 pt-10">
      <Logo />
      <Card className="grid gap-4">
        <h1 className="text-2xl font-bold [font-stretch:87%]">{m.notFound.title}</h1>
        <p className="text-muted">{m.notFound.body}</p>
        <ButtonLink href="/">{m.notFound.home}</ButtonLink>
      </Card>
      <LanguageSwitch className="justify-end" />
    </main>
  );
}
