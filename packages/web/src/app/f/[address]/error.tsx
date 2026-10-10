"use client";

import { Button } from "../../../components/ui";

/**
 * What went wrong and what to do (spec, 9.2): the chain or its history couldn't be read just now.
 * `retry` asks the server for the page again; `reset` would only redraw the error it already has.
 */
export default function FundError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto grid max-w-[560px] gap-3 p-4 pt-10">
      <p className="text-lg font-bold">No pudimos leer el fondo en este momento.</p>
      <p className="text-muted">La plata está bien: es la lectura la que falló. Probá de nuevo en un rato.</p>
      <Button onClick={retry}>Probar de nuevo</Button>
    </main>
  );
}
