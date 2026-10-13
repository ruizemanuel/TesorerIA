"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { REOPEN_PANEL, namesPanel } from "../lib/panel";
import { useRefresh } from "./refresh-provider";

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
  const { afterRefresh } = useRefresh();
  // Closed, with the URL still naming the panel until a refresh on its way lands (see close).
  const closing = useRef(false);

  /**
   * The URL follows the closing once no refresh is on its way (RefreshProvider): at once, almost always. Meanwhile
   * the URL still names the panel, and a tap on its link opens it again as it is (PanelLink), which calls the
   * closing off. By then the panel may be gone too, with the page it was on.
   */
  function close() {
    closing.current = true;
    afterRefresh(() => {
      if (!closing.current || dialog.current === null || dialog.current.open) return;
      closing.current = false;
      window.history.replaceState(null, "", closeHref);
    });
  }

  // After every render, not only the first: the dialog follows the URL. The router can still apply a closing and a
  // reopening of this same panel together (the browser's back and a tap, while a refresh is on its way): nothing
  // changes for PanelHost, this dialog stays mounted, closed, and it must open again. The URL is read, not the
  // router's state: right after a closing it no longer names the panel, while the router can still say it does.
  useEffect(() => {
    const element = dialog.current;
    if (element === null || element.open || closing.current) return;
    if (namesPanel(new URLSearchParams(window.location.search), panel)) element.showModal();
  });

  useEffect(() => {
    const reopen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== panel) return;
      closing.current = false;
      if (dialog.current?.open === false) dialog.current.showModal();
    };
    window.addEventListener(REOPEN_PANEL, reopen);
    return () => window.removeEventListener(REOPEN_PANEL, reopen);
  }, [panel]);

  return (
    <dialog ref={dialog} className="panel" aria-labelledby="panel-title" onClose={close}>
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
