import { issueChallenge } from "../../../../lib/auth";
import { env } from "../../../../lib/env";
import { getSession } from "../../../../lib/session";

export async function POST() {
  const session = await getSession();
  const challenge = issueChallenge(session);
  await session.save();
  // The site a new passkey is made for: the page asks for it instead of guessing from where it runs.
  return Response.json({ challenge, rpId: env().RP_ID });
}
