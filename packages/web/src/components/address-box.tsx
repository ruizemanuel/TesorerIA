"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "./ui";

/** The warning that goes with an address on Celo, wherever money is sent to one (spec, 9.2). */
export function NetworkWarning() {
  return (
    <p className="rounded-[14px] border-2 border-owe bg-owe-tint p-3 text-[15px] font-bold text-owe">
      Elegí la red CELO. Si elegís otra, la plata se pierde.
    </p>
  );
}

/** Your account's address, only here (spec, 9.2): whole, as wallets show it, with its QR, "Copiar" and the network warning. */
export function AddressBox({ address }: { address: string }) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(address, { type: "svg", margin: 1, color: { dark: "#1B1F3B", light: "#FFFFFF" } })
      .then((drawn) => live && setSvg(drawn))
      .catch(() => {}); // the address is written out below, so the QR is a convenience
    return () => {
      live = false;
    };
  }, [address]);
  return (
    <div className="grid gap-3">
      <NetworkWarning />
      {/* The QR is SVG this component generated from the address itself. */}
      <div className="mx-auto size-44 [&>svg]:size-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      {/* No spaces, so it can be copied by hand. `narrow` fits its 42 characters on one line of a 360 px phone, and
          `break-all` still breaks it on a narrower one. */}
      <p className="narrow break-all rounded-[14px] bg-surface p-3 text-center text-[15px] font-semibold [font-variant-numeric:lining-nums_tabular-nums]">
        {address}
      </p>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied("yes");
          } catch {
            setCopied("failed"); // no permission, or not a secure page: the address is on screen to select
          }
        }}
      >
        {copied === "yes" ? "Copiada" : "Copiar la dirección"}
      </Button>
      <p role="status" className={copied === "failed" ? "text-sm text-owe" : "sr-only"}>
        {copied === "yes" ? "Dirección copiada." : copied === "failed" ? "No se pudo copiar. Seleccioná la dirección y copiala." : ""}
      </p>
    </div>
  );
}
