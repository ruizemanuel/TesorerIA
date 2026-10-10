import { getSession } from "../../../../lib/session";

export async function POST() {
  (await getSession()).destroy();
  return new Response(null, { status: 204 });
}
