"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { type PanelState, panelKey, readPanel } from "../lib/panel";
import { Avatar } from "./avatar";
import { Panel } from "./panel";

type Fixed = Exclude<PanelState["kind"], "comprobante">;

const TITLES: Record<PanelState["kind"], string> = {
  aportar: "Aportar",
  gasto: "Cargar un gasto",
  cuenta: "Tu cuenta",
  pesos: "Pasar a pesos",
  agente: "Agente",
  comprobante: "Comprobante",
};

/**
 * The panel the URL names (spec, 9.2). The server sends every panel's content with the page, so opening one
 * (PanelLink) and closing it never wait for the server: only the URL changes, and with it useSearchParams.
 * `receipts` holds each comprobante by its item's id.
 */
export function PanelHost({
  closeHref,
  panels = {},
  receipts,
}: {
  closeHref: string;
  panels?: Partial<Record<Fixed, ReactNode>>;
  receipts: Record<string, ReactNode>;
}) {
  const state = readPanel(useSearchParams());
  if (state === null) return null;
  const content =
    state.kind === "comprobante" ? (Object.hasOwn(receipts, state.id) ? receipts[state.id] : undefined) : panels[state.kind];
  if (content === undefined) return null;
  // Keyed by what it shows: going from one comprobante straight to another opens a fresh dialog.
  const key = panelKey(state);
  // The agent's panel carries its avatar by the title (spec, 9.2).
  const icon = state.kind === "agente" ? <Avatar kind="agent" /> : undefined;
  return (
    <Panel key={key} panel={key} title={TITLES[state.kind]} icon={icon} closeHref={closeHref}>
      {content}
    </Panel>
  );
}
