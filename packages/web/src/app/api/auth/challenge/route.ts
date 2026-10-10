import { issueChallenge } from "../../../../lib/auth";
import { getSession } from "../../../../lib/session";

export async function POST() {
  const session = await getSession();
  const challenge = issueChallenge(session);
  await session.save();
  return Response.json({ challenge });
}
