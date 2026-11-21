import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CreateFundForm } from "../../components/create-fund-form";
import { LanguageSwitch } from "../../components/language-switch";
import { Card, Logo } from "../../components/ui";
import { type CountryCode, isCountryCode } from "../../lib/countries";
import { offeredNow } from "../../lib/countries-env";
import { currentUser } from "../../lib/current-user";
import { LocaleProvider } from "../../lib/i18n/client";
import { getMessages, getPageCountry } from "../../lib/i18n/server";

type Search = Promise<{ country?: string | string[] }>;

/**
 * The country the group is from (spec, 9): the one the page's link names (`?country=MX`, from "¿De dónde es el
 * grupo?") if this deployment offers it, else the page's own, its IP's if offered.
 */
async function chosenCountry(searchParams: Search): Promise<CountryCode> {
  const { country } = await searchParams;
  return isCountryCode(country) && offeredNow().includes(country) ? country : getPageCountry();
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  return { title: (await getMessages(await chosenCountry(searchParams))).home.create };
}

/**
 * Creating a fund (spec, 9, screen 7), for the country chosen: its texts, its defaults and the way it writes an amount
 * change together, built here, and the form, which runs in the browser, speaks it too.
 */
export default async function CreatePage({ searchParams }: { searchParams: Search }) {
  await connection(); // it depends on who's asking, so it's never prerendered at build time (no settings there)
  const country = await chosenCountry(searchParams);
  const m = await getMessages(country);
  const user = await currentUser();
  return (
    <LocaleProvider locale={m.locale} country={country}>
      <main lang={m.country.htmlLang[m.locale]} className="mx-auto grid max-w-[560px] gap-4 p-4 pt-8">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <LanguageSwitch />
        </div>
        <Card className="grid gap-4">
          <h1 className="text-2xl font-bold [font-stretch:87%]">{m.create.title}</h1>
          <p className="text-muted">{m.create.lead}</p>
          <CreateFundForm loggedIn={user !== null} country={country} offered={offeredNow()} />
        </Card>
      </main>
    </LocaleProvider>
  );
}
