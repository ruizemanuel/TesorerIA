import { formatPesos } from "../lib/format";
import type { FundView } from "../lib/fund-view";
import { FundNameRow } from "./bars";
import { CountUp } from "./count-up";
import { ButtonLink } from "./ui";

/**
 * The balance, your status and the two actions: Aportar and Cargar gasto (spec, 9.2, Inicio 1–2). Up to 1023 px
 * it's the white band under the screen's top, over the 4 px stripe; from 1024 px, a card (the stripe is the top bar's).
 */
export function FundHeader({
  view,
  readOnly,
  previousBalance,
  userName,
}: {
  view: FundView;
  readOnly: boolean;
  previousBalance?: bigint;
  userName?: string;
}) {
  const { me } = view;
  return (
    <section className="border-b-4 border-primary bg-surface lg:rounded-[14px] lg:border-b-0">
      <div className="mx-auto max-w-[560px] px-4 pb-5 pt-1.5 lg:max-w-none lg:p-5">
        <div className="lg:hidden">
          <FundNameRow fundName={view.name} address={view.address} userName={userName} />
        </div>
        <p className="narrow money mt-1 text-[50px] font-bold leading-none lg:mt-0 lg:text-[52px]">
          {previousBalance === undefined ? formatPesos(view.balance) : <CountUp from={previousBalance} to={view.balance} />}
        </p>
        <p className="mt-1 text-sm text-muted">
          en el fondo.{" "}
          {me !== null &&
            (me.owed === 0n ? (
              "Estás al día. "
            ) : (
              <span className="font-semibold text-owe">
                Debés <span className="money">{formatPesos(me.owed)}</span>.{" "}
              </span>
            ))}
          {me !== null && (
            <>
              Si se cerrara hoy, te tocan <span className="money">{formatPesos(me.share)}</span>.
            </>
          )}
        </p>
        {!readOnly && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ButtonLink href="?p=aportar" scroll={false}>
              Aportar
            </ButtonLink>
            <ButtonLink href="?p=gasto" variant="secondary" scroll={false}>
              Cargar gasto
            </ButtonLink>
          </div>
        )}
      </div>
    </section>
  );
}
