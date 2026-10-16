import type { ReactNode } from "react";
import type { FundScreen } from "../lib/read-fund";
import { SummaryPanel } from "./summary-panel";

/** Each week summary's panel, by the contract's week (PanelHost), with its buttons only where they're of use (spec, 9.4). */
export function summaryPanels(summaries: FundScreen["weekSummaries"], { shareable }: { shareable: boolean }): Record<string, ReactNode> {
  return Object.fromEntries(summaries.map(({ week, text }) => [String(week), <SummaryPanel text={text} shareable={shareable} />]));
}
