"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { isPlainClick, samePage } from "../lib/panel";

/**
 * A link to a panel (`?p=…`, spec 9.2). On the page the panel belongs to, it opens at once: the URL changes through
 * the History API, which Next's router syncs to useSearchParams (PanelHost) without asking the server. From any other
 * page (Movimientos, say) it's an ordinary link to the panel's page.
 */
export function PanelLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const here = samePage(href, pathname);
  return (
    <Link
      href={href}
      scroll={false}
      // On its own page there's nothing to fetch: the panel came with the page.
      prefetch={here ? false : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!here || !isPlainClick(event)) return;
        event.preventDefault();
        window.history.pushState(null, "", href);
      }}
      {...props}
    />
  );
}
