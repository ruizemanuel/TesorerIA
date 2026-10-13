"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { namesPanel } from "../lib/panel";

/**
 * Aportar, Cargar gasto, the comprobante and the rest open here (spec, 9.2): a native <dialog>, which traps
 * the focus and closes with Escape. The panel lives in the URL (`?p=…`), so closing it goes to `closeHref`,
 * through the History API like PanelLink: the page under it is already there, and the server isn't asked again.
 * `panel` is what it shows (panelKey); `icon`, if any, goes before the title.
 */
export function Panel({
  panel,
  title,
  icon,
  closeHref,
  children,
}: {
  panel: string;
  title: string;
  icon?: ReactNode;
  closeHref: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // After every render, not only the first. While a refresh is in flight the router holds the URL changes behind
  // it, so a closing and the tap that opens this same panel again can reach the page together: nothing changes for
  // PanelHost, this dialog stays mounted, closed, and it must open again. The URL is read, not the router's state:
  // right after Volver it no longer names the panel, while the router can still say it does.
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open && namesPanel(new URLSearchParams(window.location.search), panel)) element.showModal();
  });
  return (
    <dialog
      ref={dialog}
      className="panel"
      aria-labelledby="panel-title"
      onClose={() => window.history.replaceState(null, "", closeHref)}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full text-xl text-primary"
            aria-label="Volver"
            onClick={() => dialog.current?.close()}
          >
            ←
          </button>
          {icon}
          <h2 id="panel-title" className="text-lg font-bold [font-stretch:87%]">
            {title}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}
