"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * Aportar, Cargar gasto, the comprobante and the rest open here (spec, 9.2): a native <dialog>, which traps
 * the focus and closes with Escape. The panel lives in the URL (`?p=…`), so closing it goes to `closeHref`.
 */
export function Panel({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="panel"
      aria-labelledby="panel-title"
      onClose={() => router.replace(closeHref, { scroll: false })}
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
          <h2 id="panel-title" className="text-lg font-bold [font-stretch:87%]">
            {title}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}
