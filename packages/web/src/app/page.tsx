import { FUND_FACTORY } from "@tesoreria/agent";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAddress } from "viem";
import { ButtonLink, Card, Logo } from "../components/ui";
import { WeekList } from "../components/week-list";
import { currentUser } from "../lib/current-user";
import { getDb } from "../lib/db/client";
import { env } from "../lib/env";
import { fundsOf } from "../lib/funds";
import { loadFundScreen } from "../lib/read-fund";

const STEPS = [
  "Armás el fondo y sumás a tus amigos con un link.",
  "Cada uno aporta su cuota, en pesos o en USDT.",
  "El agente devuelve lo acordado, les avisa a los atrasados, y lo demás se vota.",
];

/** The real group's fund for the portada, or null: a settings or chain problem never takes the portada down. */
async function liveFund(address: string) {
  try {
    return await loadFundScreen(getAddress(address), null, { publicView: true });
  } catch {
    return null;
  }
}

/** The portada (spec, 9.2): what it is, the real group's week live, and the links for the judges. */
export default async function Home() {
  await connection(); // it depends on who's asking and reads the chain, so it's never prerendered at build time
  const user = await currentUser();
  if (user) {
    const [first] = await fundsOf(await getDb(), user.id);
    if (first) redirect(first.address ? `/f/${first.address}` : `/f/borrador/${first.id}`);
  }
  const publicFund = env().PUBLIC_FUND;
  // Without the live list it's the same page, with "Entrar" in the place of "Ver un fondo real".
  const real = publicFund ? await liveFund(publicFund) : null;

  return (
    <main className="mx-auto grid max-w-[560px] gap-8 p-4 pt-8 lg:max-w-[1120px] lg:p-7 lg:pt-12">
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="grid gap-5">
          <Logo />
          <h1 className="narrow text-[44px] font-bold leading-[1.05] lg:text-[56px]">La plata del grupo, sin tesorero.</h1>
          <p className="max-w-[46ch] text-[17px] text-muted">
            Un fondo en pesos para tu grupo, que administra un agente con límites que nadie puede cambiar solo.
          </p>
          <div className="grid max-w-[420px] grid-cols-2 gap-2">
            <ButtonLink href="/crear">Crear un fondo</ButtonLink>
            {real ? (
              <ButtonLink href={`/f/${real.view.address}/publico`} variant="secondary">
                Ver un fondo real
              </ButtonLink>
            ) : (
              <ButtonLink href="/entrar" variant="secondary">
                Entrar
              </ButtonLink>
            )}
          </div>
          {real && (
            <ButtonLink href="/entrar" variant="link" className="justify-self-start">
              Ya tengo un fondo: entrar
            </ButtonLink>
          )}
        </div>
        {real && (
          <div className="grid gap-2">
            <p className="text-sm text-muted">
              <span className="font-semibold text-ink">{real.view.name}</span>, en vivo.
            </p>
            <WeekList view={real.view} />
          </div>
        )}
      </div>
      <Card className="grid gap-3">
        <h2 className="text-lg font-bold [font-stretch:87%]">Cómo funciona</h2>
        <ol className="grid gap-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="w-6 text-xl font-bold text-num [font-stretch:75%]">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-[13px] text-muted">
        Corre en{" "}
        <a className="font-semibold text-primary" href="https://celo.blockscout.com">
          Celo mainnet
        </a>
        , con{" "}
        <a className="font-semibold text-primary" href={`https://celo.blockscout.com/address/${FUND_FACTORY}`}>
          el contrato verificado
        </a>
        ,{" "}
        <a className="font-semibold text-primary" href="https://8004scan.io/agents/celo/9887">
          el agente registrado en ERC-8004 (#9887)
        </a>{" "}
        y{" "}
        <a className="font-semibold text-primary" href="https://github.com/ruizemanuel/TesorerIA">
          el código abierto
        </a>
        .
      </p>
    </main>
  );
}
