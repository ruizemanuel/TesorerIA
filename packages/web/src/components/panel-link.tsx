"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { REOPEN_PANEL, hrefPanel, isPlainClick, namesPanel, samePage } from "../lib/panel";
import { useRefresh } from "./refresh-provider";

/**
 * A link to a panel (`?p=…`, spec 9.2). On the page the panel belongs to, it opens at once: the URL changes through
 * the History API, which Next's router syncs to useSearchParams (PanelHost) without asking the server. The change
 * waits for a refresh on its way, as a panel's closing does (Panel). From any other page (Movimientos, say) it's an
 * ordinary link to the panel's page.
 */
export function PanelLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const { afterRefresh } = useRefresh();
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
        // A panel closed while a refresh is on its way still has the URL (Panel): it opens again as it is.
        const panel = hrefPanel(href, window.location.href);
        if (panel !== null && namesPanel(new URLSearchParams(window.location.search), panel)) {
          window.dispatchEvent(new CustomEvent(REOPEN_PANEL, { detail: panel }));
          return;
        }
        // Unless the page changed meanwhile.
        const page = window.location.pathname;
        afterRefresh(() => {
          if (window.location.pathname === page) window.history.pushState(null, "", href);
        });
      }}
      {...props}
    />
  );
}
