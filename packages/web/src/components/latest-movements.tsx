import Link from "next/link";
import type { ComponentProps } from "react";
import type { Address } from "viem";
import { TimelineList } from "./timeline-list";

/** Where Ver todos goes (spec, 9.6): Movimientos for a member, the public view's own list for anyone else. */
export function movementsPath(fund: Address, publicView: boolean): string {
  return publicView ? `/f/${fund}/publico/movimientos` : `/f/${fund}/movimientos`;
}

/** The inicio's newest movements, `shown` at most, and Ver todos when there are more (spec, 9.6). */
export function LatestMovements({
  items,
  shown,
  href,
  ...list
}: ComponentProps<typeof TimelineList> & {
  shown: number;
  /** Every movement: `movementsPath`. */
  href: string;
}) {
  return (
    <>
      <TimelineList items={items.slice(0, shown)} {...list} />
      {items.length > shown && (
        <Link href={href} className="inline-flex min-h-11 items-center text-[13px] font-bold text-primary">
          {list.m.movements.seeAll}
        </Link>
      )}
    </>
  );
}
