import type { ComponentProps } from "react";
import { TimelineList } from "./timeline-list";
import { Card, CardTitle } from "./ui";

/**
 * Te toca (spec, 9.8): the proposals that wait for the viewer, on the inicio above the week, with the rows and buttons
 * they have in Movimientos. Nothing when none does: `items` comes from splitYourTurn.
 */
export function YourTurn(list: ComponentProps<typeof TimelineList>) {
  if (list.items.length === 0) return null;
  return (
    <Card>
      <CardTitle>{list.m.movements.yourTurn}</CardTitle>
      <TimelineList {...list} />
    </Card>
  );
}
