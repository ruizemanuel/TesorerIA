import { expect, test } from "@playwright/test";
import { accountOf, give, onScreen, open, phone } from "./support";

test("three friends create a fund, contribute, get the agreed expense back and vote on another", async ({ browser }) => {
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
  await ana.getByRole("button", { name: "Crear el fondo" }).click();
  await expect(ana).toHaveURL(/\/f\/0x[0-9a-fA-F]{40}$/);
  await expect(ana.getByText(/debe/)).toHaveCount(3); // the fund's inicio, with nobody paid yet
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

  // 3. Beto contributes 10 USDT; the run after it converts them.
  await give(await accountOf(beto), { usdt: 10_000_000n });
  await open(beto, `${fund}?p=aportar`);
  await beto.getByRole("button", { name: /Aportar 10\sUSDT/ }).click();
  await expect(beto).toHaveURL(/\?aporte=/);
  await expect(beto.getByRole("img", { name: "pagó" })).toHaveCount(1); // Beto's; Ana and Caro still owe
  await expect(async () => {
    await beto.goto(`${fund}/movimientos`);
    await expect(onScreen(beto, /Pasé a pesos los 10\sUSDT/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });

  // 4. Ana contributes $ 10.000 in wARS.
  await give(await accountOf(ana), { wars: 10_000n * 10n ** 18n });
  await open(ana, `${fund}?p=aportar`);
  await ana.getByRole("tab", { name: "Tengo pesos en Ripio" }).click();
  // The run after a contribution (or its once-a-minute refusal): it ends before Ana's expense, which then finds the agent free.
  const runAfterContribution = ana.waitForResponse((response) => response.url().endsWith("/api/agent/run"));
  await ana.getByRole("button", { name: /Aportar \$\s10\.000/ }).click();
  await expect(ana).toHaveURL(/\?aporte=/);
  await expect(ana.getByRole("img", { name: "pagó" })).toHaveCount(2);
  await runAfterContribution;

  // 5. Ana enters the pitch: the agent pays it back.
  await open(ana, `${fund}?p=gasto`);
  await ana.getByLabel("Cuánto pagaste").fill("5.000");
  await ana.getByLabel("Nota (opcional)").fill("la cancha del jueves");
  await ana.getByRole("button", { name: "Cargar el gasto" }).click();
  await expect(ana.getByText("Listo: el agente te devolvió la plata.")).toBeVisible();
  await expect(onScreen(ana, /Le devolví \$\s5\.000 a Ana/)).toBeVisible(); // the inicio behind the panel, refreshed
  await ana.goto(`${fund}/movimientos`);
  await expect(onScreen(ana, /Le devolví \$\s5\.000 a Ana por la cancha/)).toBeVisible();

  // 6. Caro enters another expense: the agent proposes it.
  await give(await accountOf(caro));
  await open(caro, `${fund}?p=gasto`);
  await caro.getByLabel("Otro gasto (se vota)").check();
  await caro.getByLabel("Cuánto pagaste").fill("3.000");
  await caro.getByLabel("Nota (opcional)").fill("la pelota nueva");
  await caro.getByRole("button", { name: "Cargar el gasto" }).click();
  await expect(caro.getByText(/el agente lo propuso/)).toBeVisible();

  // 7. Ana votes (1 of 2); Beto's vote completes the count and executes it in the same operation.
  await open(ana, `${fund}/movimientos`);
  await ana.getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(ana, "Votaste")).toBeVisible();
  await open(beto, `${fund}/movimientos`);
  await beto.getByRole("button", { name: "Votar" }).click();
  await expect(onScreen(beto, /El fondo le pagó \$\s3\.000 a Caro/)).toBeVisible();
  await expect(onScreen(beto, /pelota nueva\. Se aprobó\./)).toBeVisible();
});
