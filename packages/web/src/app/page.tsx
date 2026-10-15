import { FUND_FACTORY, shortMessage } from "@tesoreria/agent";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAddress } from "viem";
import { LanguageSwitch } from "../components/language-switch";
import { ButtonLink, Card, Logo } from "../components/ui";
import { WeekList } from "../components/week-list";
import { currentUser } from "../lib/current-user";
import { getDb } from "../lib/db/client";
import { env } from "../lib/env";
import { fundsOf } from "../lib/funds";
import type { Locale } from "../lib/i18n/locales";
import { getLocale, getMessages } from "../lib/i18n/server";
import { loadPublicFundScreen } from "../lib/read-fund";

/**
 * The real group's fund for the portada, or null: a settings or chain problem never takes the portada down, but it
 * goes to the logs, so a portada without its live week doesn't go unnoticed.
 */
async function liveFund(address: string, locale: Locale) {
  try {
    return await loadPublicFundScreen(getAddress(address), locale);
  } catch (error) {
    console.error(`The portada could not read the public fund: ${shortMessage(error)}`);
    return null;
  }
}

/** A link of the line for the judges. */
function judgesLink(href: string, label: string) {
  return (
    <a className="font-semibold text-primary" href={href}>
      {label}
    </a>
  );
}

/** The portada (spec, 9.2): what it is, the real group's week live, and the links for the judges. */
export default async function Home() {
  await connection(); // it depends on who's asking and reads the chain, so it's never prerendered at build time
  const m = await getMessages();
  const locale = await getLocale();
  const user = await currentUser();
  if (user) {
    const [first] = await fundsOf(await getDb(), user.id);
    if (first) redirect(first.address ? `/f/${first.address}` : `/f/borrador/${first.id}`);
  }
  const publicFund = env().PUBLIC_FUND;
  // Without the live list it's the same page, with "Entrar" in the place of "Ver un fondo real".
  const real = publicFund ? await liveFund(publicFund, locale) : null;

  return (
    <main className="mx-auto grid max-w-[560px] gap-8 p-4 pt-8 lg:max-w-[1120px] lg:p-7 lg:pt-12">
      <div className="grid gap-5">
        <div className="flex items-center justify-between">
          <Logo />
          <LanguageSwitch />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-10">
          <div className="grid gap-5">
            <h1 className="narrow text-[44px] font-bold leading-[1.05] lg:text-[56px]">{m.home.title}</h1>
            <p className="max-w-[46ch] text-[17px] text-muted">{m.home.lead}</p>
            <div className="grid max-w-[420px] grid-cols-2 gap-2">
              <ButtonLink href="/crear">{m.home.create}</ButtonLink>
              {real ? (
                <ButtonLink href={`/f/${real.view.address}/publico`} variant="secondary">
                  {m.home.seeReal}
                </ButtonLink>
              ) : (
                <ButtonLink href="/entrar" variant="secondary">
                  {m.home.logIn}
                </ButtonLink>
              )}
            </div>
            {real && (
              <ButtonLink href="/entrar" variant="link" className="justify-self-start">
                {m.home.haveFund}
              </ButtonLink>
            )}
          </div>
          {real && (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{m.home.live(<span className="font-semibold text-ink">{real.view.name}</span>)}</p>
              <WeekList view={real.view} m={m} locale={locale} />
            </div>
          )}
        </div>
      </div>
      <Card className="grid gap-3">
        <h2 className="text-lg font-bold [font-stretch:87%]">{m.home.howItWorks}</h2>
        <ol className="grid gap-2">
          {m.home.steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="w-6 text-xl font-bold text-num [font-stretch:75%]">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-[13px] text-muted">
        {m.home.judges(
          judgesLink("https://celo.blockscout.com", m.home.judgesLinks.celo),
          judgesLink(`https://celo.blockscout.com/address/${FUND_FACTORY}`, m.home.judgesLinks.contract),
          judgesLink("https://8004scan.io/agents/celo/9887", m.home.judgesLinks.agent),
          judgesLink("https://github.com/ruizemanuel/TesorerIA", m.home.judgesLinks.code),
        )}
      </p>
    </main>
  );
}
