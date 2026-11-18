import { FUND_FACTORY, FUND_FACTORY_V2 } from "@tesoreria/agent";
import type { Messages } from "../lib/i18n/messages";

/** A link of the line for the judges. */
function judgesLink(href: string, label: string) {
  return (
    <a className="font-semibold text-primary" href={href}>
      {label}
    </a>
  );
}

const EXPLORER = "https://celo.blockscout.com";

/**
 * The portada's line for the judges: the network, the two FundFactory contracts (one link each, to its page on
 * Blockscout, where their source shows as verified), the agent's ERC-8004 identity and the code.
 */
export function HomeJudges({ m }: { m: Messages }) {
  const links = m.home.judgesLinks;
  return (
    <p className="text-[13px] text-muted">
      {m.home.judges(
        judgesLink(EXPLORER, links.celo),
        links.contracts(judgesLink(`${EXPLORER}/address/${FUND_FACTORY}`, "v1"), judgesLink(`${EXPLORER}/address/${FUND_FACTORY_V2}`, "v2")),
        judgesLink("https://8004scan.io/agents/celo/9887", links.agent),
        judgesLink("https://github.com/ruizemanuel/TesorerIA", links.code),
      )}
    </p>
  );
}
