import { type Page, type Request, type Route, expect, test } from "@playwright/test";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { accountOf, give, onScreen, open, phone, warsOf } from "./support";

/** The server renders (React Server Components) a page asks for while `act` runs; a link's prefetch isn't one. */
async function serverRenders(page: Page, act: () => Promise<void>): Promise<string[]> {
  const asked: string[] = [];
  const onRequest = (request: Request) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" && headers["next-router-prefetch"] === undefined) asked.push(request.url());
  };
  page.on("request", onRequest);
  try {
    await act();
  } finally {
    page.off("request", onRequest);
  }
  return asked;
}

test("three friends create a fund, contribute, get the agreed expense back, and vote on and execute others, and pass what they got back on to Ripio", async ({ browser }) => {
  const ana = await phone(await browser.newContext());
  const beto = await phone(await browser.newContext());
  const caro = await phone(await browser.newContext());

  // 1. Ana creates her passkey and the fund; Beto and Caro join by the link.
  await open(ana, "/crear");
  await ana.getByLabel("Tu nombre").fill("Ana");
  await ana.getByLabel("Nombre del fondo").fill("Fútbol de los jueves");
  await ana.getByRole("button", { name: "Crear mi passkey y el fondo" }).click();
  await expect(ana).toHaveURL(/\/f\/borrador\//);
  const invite = (await ana.getByText("/invitacion/").textContent())!.trim();
  for (const [page, name] of [
    [beto, "Beto"],
    [caro, "Caro"],
  ] as const) {
    await open(page, invite);
    await expect(page.getByRole("heading", { name: /Ana te invitó a/ })).toBeVisible();
    await page.getByLabel("Tu nombre").fill(name);
    await page.getByRole("button", { name: "Sumarme" }).click();
    await expect(page).toHaveURL(/\/f\/borrador\//);
  }

  // 2. Ana deploys it, 2 votes of 3, signing with her passkey.
  await give(await accountOf(ana));
  await ana.reload({ waitUntil: "networkidle" });
  await ana.getByLabel(/Votos necesarios/).selectOption("2");
  await ana.getByRole("button", { name: "Crear fondo" }).click();
  await expect(ana).toHaveURL(/\/f\/0x[0-9a-fA-F]{40}$/);
  await expect(onScreen(ana, /debe/)).toHaveCount(3); // the fund's inicio, with nobody paid yet
  const fund = new URL(ana.url()).pathname;

  // Ana leaves, and comes back to the fund by entering with her passkey (spec, 11: "entrar").
  await open(ana, `${fund}?p=cuenta`);
  await ana.getByRole("button", { name: "Salir" }).click();
  await expect(ana).toHaveURL(/localhost:3000\/$/);
  await ana.goto(fund);
  await expect(ana).toHaveURL(/\/entrar\?next=/);
  await ana.waitForLoadState("networkidle"); // see open()
  await ana.getByRole("button", { name: "Entrar con mi passkey" }).click();
  await expect(ana).toHaveURL(new RegExp(`${fund}$`));

  // 3. Beto contributes 10 USDT; the run after it converts them. Aportar offers what covers his week (a little over
  // 6 USDT at the fork's price), and he puts in all 10: what goes over is paid ahead.
  await give(await accountOf(beto), { usdt: 10_000_000n });
  await open(beto, `${fund}?p=aportar`);
  await expect(onScreen(beto, /Cubre los \$\s10\.000, al precio de ahora\./)).toBeVisible();
  await beto.getByLabel("Cuánto aportás").fill("10");
  await expect(onScreen(beto, /Son unos \$\s[\d.]+(,\d{1,2})? al precio de ahora\./)).toBeVisible();
  await beto.getByRole("button", { name: /Aportar 10\sUSDT/ }).click();
  await expect(beto).toHaveURL(/\?aporte=/);
  await expect(beto.getByRole("img", { name: "pagó" })).toHaveCount(1); // Beto's; Ana and Caro still owe
  await expect(onScreen(beto, /Estás al día, con \$\s[\d.]+(,\d{1,2})? adelantados\./)).toBeVisible();
  await expect(async () => {
    await beto.goto(`${fund}/movimientos`);
    await expect(onScreen(beto, /Pasé a pesos los 10\sUSDT/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  // Ana's inicio, open all along and never reloaded, catches up by itself (spec, 9.2).
  await expect(ana.getByRole("img", { name: "pagó" })).toHaveCount(1);
  await expect(onScreen(ana, /Pasé a pesos los 10\sUSDT/)).toBeVisible();
  // With nothing new on the chain, it doesn't ask the server again: a look (one every 15 s) reads only the chain.
  expect(await serverRenders(ana, () => ana.waitForTimeout(20_000))).toEqual([]);

  // 4. Ana contributes $ 10.000 in wARS. Aportar opens from her inicio without asking the server again.
  await give(await accountOf(ana), { wars: 10_000n * 10n ** 18n });
  const openingAportar = await serverRenders(ana, async () => {
    // The header's (the empty timeline has one too).
    await ana.getByRole("link", { name: "Aportar" }).first().click();
    await expect(ana.getByRole("dialog", { name: "Aportar" })).toBeVisible();
  });
  expect(openingAportar).toEqual([]);
  await expect(ana).toHaveURL(/\?p=aportar$/);
  await ana.getByRole("tab", { name: "Tengo pesos en Ripio" }).click();
  // The run after a contribution must end before Ana's expense, which then finds the agent free. The route answers
  // 202 once it ran (or found the agent busy), and 429 when the once-a-minute limit refuses it.
  const runAfterContribution = ana.waitForResponse((response) => response.url().endsWith("/api/agent/run"), { timeout: 30_000 });
  await ana.getByRole("button", { name: /Aportar \$\s10\.000/ }).click();
  await expect(ana).toHaveURL(/\?aporte=/);
  await expect(ana.getByRole("img", { name: "pagó" })).toHaveCount(2);
  expect([202, 429]).toContain((await runAfterContribution).status());

  // 5. Ana enters the pitch: the agent pays it back. Its panel closes by its own button and by the browser's back,
  // and opens again, all without the server.
  const closingAndOpening = await serverRenders(ana, async () => {
    const expense = ana.getByRole("dialog", { name: "Cargar un gasto" });
    await ana.getByRole("link", { name: "Cargar gasto" }).click();
    await expect(expense).toBeVisible();
    await ana.getByRole("button", { name: "Volver" }).click();
    await expect(expense).toBeHidden();
    await expect(ana).toHaveURL(new RegExp(`${fund}$`));
    await ana.getByRole("link", { name: "Cargar gasto" }).click();
    await expect(expense).toBeVisible();
    await ana.goBack();
    await expect(expense).toBeHidden();
    await ana.getByRole("link", { name: "Cargar gasto" }).click();
    await expect(expense).toBeVisible();
  });
  expect(closingAndOpening).toEqual([]);
  await ana.getByLabel("Cuánto pagaste").fill("5.000");
  await ana.getByLabel("Nota (opcional)").fill("la cancha del jueves");
  await ana.getByRole("button", { name: "Cargar el gasto" }).click();
  await expect(ana.getByText("Listo: el agente te devolvió la plata.")).toBeVisible();
  await expect(onScreen(ana, /Le devolví \$\s5\.000 a Ana/)).toBeVisible(); // the inicio behind the panel, refreshed
  await ana.goto(`${fund}/movimientos`);
  await expect(onScreen(ana, /Le devolví \$\s5\.000 a Ana por la cancha/)).toBeVisible();

  // 6. Caro enters another expense: the agent proposes it.
  await open(caro, `${fund}?p=gasto`);
  await caro.getByLabel("Otro gasto (se vota)").check();
  await caro.getByLabel("Cuánto pagaste").fill("3.000");
  await caro.getByLabel("Nota (opcional)").fill("la pelota nueva");
  await caro.getByRole("button", { name: "Cargar el gasto" }).click();
  await expect(caro.getByText(/el agente lo propuso/)).toBeVisible();

  // 7. Ana votes (1 of 2); Beto's vote completes the count and executes it in the same operation. Each vote fires a
  // run of the agent that nobody waits for: the expenses of step 8 must find the agent free (see 4).
  const agentRunOf = (page: Page) => page.waitForResponse((response) => response.url().endsWith("/api/agent/run"), { timeout: 30_000 });
  await open(ana, `${fund}/movimientos`);
  const runAfterAnasVote = agentRunOf(ana);
  await ana.getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(ana, "Votaste")).toBeVisible();
  await open(beto, `${fund}/movimientos`);
  const runAfterBetosVote = agentRunOf(beto);
  await beto.getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(beto, /El fondo le pagó \$\s3\.000 a Caro/)).toBeVisible();
  await expect(onScreen(beto, /pelota nueva\. Se aprobó\./)).toBeVisible();
  await Promise.all([runAfterAnasVote, runAfterBetosVote]);

  // 8. Two more of Caro's expenses, $ 12.000 each: the fund can pay one of them, not both. The first is approved and
  // paid; the vote that completes the second can't pay it, so it goes alone, and the proposal waits for pesos.
  for (const note of ["el asado", "las camisetas"]) {
    await open(caro, `${fund}?p=gasto`);
    await caro.getByLabel("Otro gasto (se vota)").check();
    await caro.getByLabel("Cuánto pagaste").fill("12.000");
    await caro.getByLabel("Nota (opcional)").fill(note);
    await caro.getByRole("button", { name: "Cargar el gasto" }).click();
    // The second has the kind and the amount of one she loaded a few minutes before: the panel asks if it is another.
    if (note === "las camisetas") await caro.getByRole("button", { name: "Sí, es otro" }).click();
    await expect(caro.getByText(/el agente lo propuso/)).toBeVisible();
  }
  const proposal = (page: typeof ana, note: string) => page.getByRole("listitem").filter({ hasText: note });
  await open(ana, `${fund}/movimientos`);
  for (const note of ["el asado", "las camisetas"]) {
    await proposal(ana, note).getByRole("button", { name: "Votar" }).click();
    await expect(proposal(ana, note).getByText("Votaste")).toBeVisible();
  }
  await open(beto, `${fund}/movimientos`);
  await proposal(beto, "el asado").getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(beto, /el asado\. Se aprobó\./)).toBeVisible();
  await proposal(beto, "las camisetas").getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(beto, /las camisetas\. Tiene los votos, pero al fondo le faltan/)).toBeVisible();
  await expect(beto.getByRole("button", { name: "Ejecutar" })).toHaveCount(0);

  // 9. Caro puts in her $ 10.000, and Ana executes the proposal that was waiting.
  await give(await accountOf(caro), { wars: 10_000n * 10n ** 18n });
  await open(caro, `${fund}?p=aportar`);
  await caro.getByRole("tab", { name: "Tengo pesos en Ripio" }).click();
  await caro.getByRole("button", { name: /Aportar \$\s10\.000/ }).click();
  await expect(caro).toHaveURL(/\?aporte=/);
  await open(ana, `${fund}/movimientos`);
  await expect(onScreen(ana, /las camisetas\. Tiene los votos: falta ejecutarla\./)).toBeVisible();
  await proposal(ana, "las camisetas").getByRole("button", { name: "Ejecutar" }).click();
  await expect(onScreen(ana, /las camisetas\. Se aprobó\./)).toBeVisible();
  await expect(onScreen(ana, /El fondo le pagó \$\s12\.000 a Caro/)).toHaveCount(2);

  // 10. Beto asks the agent (the scripted model on the fork), then tells it he paid for new balls: he confirms the
  // card, and the agent proposes it. The conversation outlasts closing the panel (spec, 9.2).
  await open(beto, fund);
  await beto.getByRole("link", { name: "Agente" }).click();
  await expect(beto.getByText("Hola, Beto. Preguntame lo que quieras del fondo.")).toBeVisible();
  await beto.getByRole("button", { name: "¿Quién debe esta semana?" }).click();
  await expect(beto.getByText("Soy el agente de prueba: en el fork no hay modelo.")).toBeVisible();
  await beto.getByPlaceholder("Escribí tu pregunta").fill("Pagué $ 5.000 de pelotas nuevas");
  await beto.getByRole("button", { name: "Mandar" }).click();
  await expect(beto.getByText("Se vota: necesita 2 de 3 votos.")).toBeVisible();
  // The card refreshes the page under it. With the server slow to answer that refresh, closing the panel and opening
  // it again must open it, with the conversation: Next's router, left alone, held both behind the refresh and then
  // reloaded the page, or kept the panel closed.
  const slowServerRenders = async (route: Route) => {
    if (route.request().headers()["rsc"] === "1") await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  };
  await beto.route("**/*", slowServerRenders);
  await beto.getByRole("button", { name: "Confirmar" }).click();
  await expect(beto.getByText(/el agente lo propuso y ahora lo vota el grupo/)).toBeVisible();
  await beto.getByRole("button", { name: "Volver" }).click();
  await beto.getByRole("link", { name: "Agente" }).click();
  await expect(beto.getByRole("dialog", { name: "Agente" }).getByText(/el agente lo propuso y ahora lo vota el grupo/)).toBeVisible();
  await beto.unrouteAll({ behavior: "wait" }); // a render still held goes on, slowly
  // It outlasts the move to Movimientos too (spec, 9.2), and on a desktop's width, where the bottom bar hides, the
  // floating button takes Beto from there back to it.
  await beto.getByRole("button", { name: "Volver" }).click();
  await beto.getByRole("link", { name: "Movimientos", exact: true }).click();
  await expect(beto).toHaveURL(new RegExp(`${fund}/movimientos$`));
  await expect(onScreen(beto, /Pelotas nuevas/)).toBeVisible();
  await beto.setViewportSize({ width: 1280, height: 800 });
  await beto.getByRole("link", { name: "Preguntale al agente" }).click();
  await expect(beto.getByRole("dialog", { name: "Agente" }).getByText(/el agente lo propuso y ahora lo vota el grupo/)).toBeVisible();
  // A reload with the panel open starts a new conversation: the panel the server sends must take over in the browser
  // without errors (the empty `errors` below), and answer.
  const errors: string[] = [];
  beto.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  beto.on("pageerror", (error) => errors.push(error.message));
  await open(beto, `${fund}?p=agente`);
  const agent = beto.getByRole("dialog", { name: "Agente" });
  await expect(agent.getByText("Hola, Beto. Preguntame lo que quieras del fondo.")).toBeVisible();
  await agent.getByRole("button", { name: "¿Quién debe esta semana?" }).click();
  await expect(agent.getByText("Soy el agente de prueba: en el fork no hay modelo.")).toBeVisible();
  expect(errors).toEqual([]);

  // 11. Ana passes the $ 5.000 the agent paid her back (step 5) on to Ripio (spec, 9.2): part of it from "Tu cuenta",
  // pasting the address with the spaces a copy brings; the rest from the inicio's line, after a reload, to the
  // address her browser remembered. A fresh address stands in for her Ripio one. The passes go through /api/bundler
  // like any operation, so the server's check runs too.
  const ripio = privateKeyToAddress(generatePrivateKey());
  await open(ana, fund);
  await ana.getByRole("link", { name: "Tu cuenta" }).click();
  const account = ana.getByRole("dialog", { name: "Tu cuenta" });
  await expect(account.getByText(/\$\s5\.000/)).toBeVisible();
  await account.getByRole("link", { name: "Pasar a pesos con Ripio" }).click();
  const pesos = ana.getByRole("dialog", { name: "Pasar a pesos" });
  await pesos.getByLabel("Tu dirección de Ripio").fill(`  ${ripio} `);
  await pesos.getByLabel("Cuánto pasás").fill("2.000");
  await pesos.getByRole("button", { name: /Pasar \$\s2\.000 a Ripio/ }).click();
  await expect(pesos.getByText(/Pasaste \$\s2\.000 a Ripio/)).toBeVisible();
  expect(await warsOf(ripio)).toBe(2_000n * 10n ** 18n);
  // It reads the account again after the pass: it offers the $ 3.000 left, never the $ 5.000 it had.
  await expect(pesos.getByRole("button", { name: /Pasar \$\s3\.000 a Ripio/ })).toBeVisible();
  await expect(pesos.getByText(ripio)).toBeVisible();
  await pesos.getByRole("button", { name: "Volver" }).click();
  await expect(onScreen(ana, /En tu cuenta tenés \$\s3\.000/)).toBeVisible();
  await open(ana, fund);
  await ana.getByRole("link", { name: "Pasar a pesos", exact: true }).click();
  await expect(pesos.getByText("A tu cuenta de Ripio")).toBeVisible();
  await expect(pesos.getByText(ripio)).toBeVisible();
  await pesos.getByRole("button", { name: /Pasar \$\s3\.000 a Ripio/ }).click();
  await expect(pesos.getByText(/Pasaste \$\s3\.000 a Ripio/)).toBeVisible();
  expect(await warsOf(ripio)).toBe(5_000n * 10n ** 18n);
  expect(await warsOf(await accountOf(ana))).toBe(0n); // all of it, to the last unit
  await expect(pesos.getByText("No tenés pesos en tu cuenta para pasar.")).toBeVisible();
});
