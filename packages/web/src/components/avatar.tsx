import type { ComponentProps } from "react";
import { initials } from "../lib/format";
import { PanelLink } from "./panel-link";

/** The agent is a blue circle with "IA" (also the favicon and the ERC-8004 image); a member, their initials. */
export function Avatar({ kind, name = "" }: { kind: "agent" | "member"; name?: string }) {
  const agent = kind === "agent";
  return (
    <span
      aria-hidden="true"
      className={`grid size-8 flex-none place-items-center rounded-full text-xs font-bold ${agent ? "bg-primary text-white" : "bg-tint text-primary"}`}
    >
      {agent ? "IA" : initials(name)}
    </span>
  );
}

/**
 * Your own avatar as a link to a panel ("Tu cuenta"): the circle stays 32 px, but the touch target is 44 px (spec, 9.1).
 * The avatar is hidden from screen readers, so the link carries the `label`.
 */
export function AvatarLink({ name, label, ...props }: ComponentProps<typeof PanelLink> & { name: string; label: string }) {
  return (
    <PanelLink aria-label={label} className="grid size-11 flex-none place-items-center rounded-full" {...props}>
      <Avatar kind="member" name={name} />
    </PanelLink>
  );
}
