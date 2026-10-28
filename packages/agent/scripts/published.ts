import { shortMessage } from "../src/errors";
import { AGENT_URI, registrationFile } from "../src/registration";

/** Why AGENT_URI doesn't serve exactly this repo's registration.json, or undefined when it does. */
export async function publishedProblem(): Promise<string | undefined> {
  const published = await fetch(AGENT_URI, { cache: "no-store" })
    .then(async (response) =>
      response.ok ? { text: await response.text() } : { problem: `The agentURI answered HTTP ${response.status}.` },
    )
    .catch((error: unknown) => ({ problem: `The agentURI is unreachable: ${shortMessage(error)}.` }));
  if ("problem" in published) return published.problem;
  if (published.text !== registrationFile()) {
    return (
      "The agentURI serves a file whose content differs from this repo's registration.json: push it to main, " +
      "and give GitHub's cache up to 5 minutes."
    );
  }
  return undefined;
}
