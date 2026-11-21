import { type Page, type Response, expect, test } from "@playwright/test";
import { getAddress, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import {
  HEARTBEAT_SECRET,
  WMXN,
  accountOf,
  fundV2,
  give,
  latestBlock,
  onScreen,
  open,
  operationTimes,
  phone,
  setTokenBalance,
  wmxnOf,
} from "./support";

/** One wMXN, in its 18-decimal units. */
const U = 10n ** 18n;

/**
 * What credits `net` wMXN whole after the fund's 0.25% fee, to the unit: what Aportar sends for a week (contribute.ts'
 * withFee), and shows rounded up to the centavo. As fund.spec's.
 */
const withFee = (net: bigint) => (net * 10_000n + 9_975n - 1n) / 9_975n;

const MEXICO_CITY = "America/Mexico_City";

/**
 * Waits for the run of the agent that `page` asks for after a member's operation to end, so that the next step finds
 * the agent free: as fund.spec's. 202 once it ran (or found the agent busy), 429 when its once-a-minute limit refused
 * it, and then the page asks once more when the minute ends, and that run is waited for too.
 */
function agentRunEnds(page: Page): Promise<number> {
  const isRun = (response: Response) => response.url().endsWith("/api/agent/run");
  const first = page.waitForResponse(isRun, { timeout: 30_000 });
  return (async () => {
    const status = (await first).status();
    if (status === 429) await page.waitForResponse(isRun, { timeout: 90_000 });
    return status;
  })();
}

/** Calls the heartbeat, as fund.spec does, until it runs: it answers 202 while a run after an operation holds the agent. */
async function heartbeat(page: Page): Promise<void> {
  await expect(async () => {
    const beat = await page.request.post("/api/agent/heartbeat", { headers: { authorization: `Bearer ${HEARTBEAT_SECRET}` } });
    expect(beat.status()).toBe(200);
  }).toPass({ timeout: 60_000 });
}

/** `date` on Mexico City's clock: its day, as a number to count days by and as Spanish and English write it, and its time. */
function onMexicoCityClock(date: Date) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: MEXICO_CITY, ...options }).formatToParts(date).map(({ type, value }) => [type, value]));
  const { year, month, day } = part({ year: "numeric", month: "numeric", day: "numeric" });
  const { hour, minute } = part({ hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const { month: monthName } = part({ month: "short" });
  return {
    dayNumber: Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000,
    day: { es: `${Number(day)}/${Number(month)}`, en: `${monthName} ${Number(day)}` },
    time: `${Number(hour)}:${minute}`,
  };
}

/**
 * When Movimientos says a movement made at `at` happened, on Mexico City's clock and never Buenos Aires's (three hours
 * later): "Hoy, 9:05" ("Today, 9:05") on the server's day, "Ayer, 23:58" on the one before, and only its day, "28/11"
 * ("Nov 28"), when the fork's clock is past the server's day. That last is a full run's: fund.spec moves the fork a
 * week ahead (its step 14), and the web counts days from the server's clock. The web puts a block's time at one block a
 * second back from the latest, and the fork mines a block for each transaction too, so a few seconds off: the minutes
 * around `at` read it as well.
 */
function mexicoCityTime(at: Date, locale: "es" | "en"): RegExp {
  const words = locale === "es" ? { today: "Hoy", yesterday: "Ayer" } : { today: "Today", yesterday: "Yesterday" };
  const today = onMexicoCityClock(new Date()).dayNumber;
  const texts = [-2, -1, 0, 1, 2].map((minutes) => {
    const clock = onMexicoCityClock(new Date(at.getTime() + minutes * 60_000));
    const daysAgo = today - clock.dayNumber;
    if (daysAgo === 0) return `${words.today}, ${clock.time}`;
    if (daysAgo === 1) return `${words.yesterday}, ${clock.time}`;
    if (daysAgo < 0) return clock.day[locale];
    throw new Error(`A movement made during the test reads as ${daysAgo} days old`);
  });
  // No digit on either side: "8/11" isn't read inside "28/11", nor "Nov 2" inside "Nov 28".
  return new RegExp(`(?<!\\d)(?:${[...new Set(texts)].join("|")})(?!\\d)`);
}

test("a Mexican group creates a wMXN fund, contributes through Ripio's ramp, gets the agreed expense back, and passes it on to Ripio, in neutral Spanish and on Mexico City's clock", async ({
  browser,
}) => {
  const ana = await phone(await browser.newContext({ locale: "es-MX" }));
  const beto = await phone(await browser.newContext({ locale: "es-MX" }));
  const caro = await phone(await browser.newContext({ locale: "es-MX" }));

  // 1. Ana opens /crear, which asks where the group is from and starts in Argentina, with its defaults (with no IP to
  // read, the page's own country), and picks Mexico: the page comes back in neutral Spanish, with Mexico's defaults.
  await open(ana, "/crear");
  await expect(ana.getByText("¿De dónde es el grupo?")).toBeVisible();
  await expect(ana.getByLabel("Cuota de cada uno por semana")).toHaveValue("10.000");
  await ana.getByRole("link", { name: "México" }).click();
  await expect(ana).toHaveURL(/\/crear\?country=MX$/);
  await ana.waitForLoadState("networkidle"); // see open()
  await expect(ana.getByRole("link", { name: "México" })).toHaveAttribute("aria-current", "page");
  await expect(ana.getByRole("heading", { name: "Arma el fondo del grupo" })).toBeVisible();
  await expect(ana.getByLabel("Cuota de cada uno por semana")).toHaveValue("100");
  await expect(ana.getByLabel("Tope por semana para ese gasto")).toHaveValue("600");

  // 2. Ana creates her passkey and the fund; Beto and Caro join by the link, which speaks neutral Spanish and Mexico's
  // pesos. Ana deploys it, 2 votes of 3: a FundV2 in wMXN, with no dollar, the 0.25% fee and Mexico's cap.
  await ana.getByLabel("Tu nombre").fill("Ana");
  await ana.getByLabel("Nombre del fondo").fill("Fútbol de los viernes");
  await ana.getByRole("button", { name: "Crear mi passkey y el fondo" }).click();
  await expect(ana).toHaveURL(/\/f\/borrador\//);
  await expect(ana.getByText("Comparte este enlace en el grupo")).toBeVisible();
  const invite = (await ana.getByText("/invitacion/").textContent())!.trim();
  for (const [page, name] of [
    [beto, "Beto"],
    [caro, "Caro"],
  ] as const) {
    await open(page, invite);
    await expect(page.getByRole("heading", { name: /Ana te invitó a/ })).toBeVisible();
    await expect(onScreen(page, /Cada uno pone \$100 por semana\. El agente devuelve hasta \$600 por semana por la cancha\./)).toBeVisible();
    await page.getByLabel("Tu nombre").fill(name);
    await page.getByRole("button", { name: "Unirme" }).click();
    await expect(page).toHaveURL(/\/f\/borrador\//);
  }
  const anaAccount = await accountOf(ana);
  await give(anaAccount); // CELO for her Safe's gas: the fork has no paymaster
  await ana.reload({ waitUntil: "networkidle" });
  await ana.getByLabel(/Votos necesarios/).selectOption("2");
  await ana.getByRole("button", { name: "Crear fondo" }).click();
  await expect(ana).toHaveURL(/\/f\/0x[0-9a-fA-F]{40}$/);
  await expect(onScreen(ana, /debe/)).toHaveCount(3); // the fund's inicio, with nobody paid yet
  // The fund's pages speak its country, not the visitor's: the fund's layout says so under the page's own html.
  await expect(ana.locator("body > div[lang]")).toHaveAttribute("lang", "es-MX");
  const fund = new URL(ana.url()).pathname;
  const fundAddress = getAddress(fund.slice("/f/".length));
  expect(await fundV2(fundAddress).read.currency()).toBe(WMXN);
  expect(await fundV2(fundAddress).read.dollar()).toBe(zeroAddress);
  expect(await fundV2(fundAddress).read.feeBps()).toBe(25);
  expect(await fundV2(fundAddress).read.balanceCap()).toBe(5_000n * U);

  // 3. Ana gets her week's wMXN, what credits $100 whole after the fee, written straight into the token's storage: no
  // pool on the fork holds wMXN to give from. Aportar has no tabs, since the fund takes no USDT, only Ripio's ramp
  // (there's no Ripio app in Mexico), loading $100.25062… up to the centavo, as Argentina's $ 10.025,07; and her
  // account's address, with the warning to pick Celo. She contributes it all, to the unit.
  await setTokenBalance(WMXN, anaAccount, withFee(100n * U));
  expect(await wmxnOf(anaAccount)).toBe(withFee(100n * U));
  await open(ana, `${fund}?p=aportar`);
  const aportar = ana.getByRole("dialog", { name: "Aportar" });
  await expect(aportar.getByText("Compra wMXN con Ripio y llegan directo a tu cuenta del fondo.")).toBeVisible();
  await expect(aportar.getByRole("link", { name: "Cargar pesos con Ripio" })).toHaveAttribute(
    "href",
    `https://ramp.ripio.com/?country=MX&chain=42220&token=WMXN&amount=100.26&address=${anaAccount}`,
  );
  await expect(aportar.getByText("Elige la red CELO. Si eliges otra, el dinero se pierde.")).toBeVisible();
  await expect(aportar.getByText(anaAccount, { exact: true })).toBeVisible();
  await expect(aportar.getByRole("tab")).toHaveCount(0);
  await expect(aportar.getByText("Tengo USDT")).toHaveCount(0);
  await expect(aportar.getByText(/app de Ripio/)).toHaveCount(0);
  // The run after a contribution must end before Ana's expense, which then finds the agent free (agentRunEnds).
  const runAfterContribution = agentRunEnds(ana);
  const beforeContribution = await latestBlock();
  await aportar.getByRole("button", { name: /Aportar \$100\.26/ }).click();
  await expect(ana).toHaveURL(/\?aporte=/);
  await expect(ana.getByRole("img", { name: "pagó" })).toHaveCount(1);
  expect([202, 429]).toContain(await runAfterContribution);
  expect(await wmxnOf(anaAccount)).toBe(0n);
  expect(await wmxnOf(fundAddress)).toBe(withFee(100n * U));

  // 4. Movimientos tells her contribution as Aportar's button said it, at its time in Mexico City.
  const operations = await operationTimes(anaAccount, beforeContribution);
  expect(operations).toHaveLength(1);
  const contributedAt = operations[0]!;
  await ana.goto(`${fund}/movimientos`);
  const contribution = ana.getByRole("listitem").filter({ hasText: /Ana aportó \$100\.26\./ }).filter({ visible: true });
  await expect(contribution).toContainText(mexicoCityTime(contributedAt, "es"));

  // 5. Ana enters the agreed expense, $50: the agent pays it back from the fund. The heartbeat then runs over the
  // Mexican fund too, and Movimientos tells the reimbursement in neutral Spanish.
  await open(ana, `${fund}?p=gasto`);
  const expense = ana.getByRole("dialog", { name: "Cargar un gasto" });
  await expense.getByLabel("Cuánto pagaste").fill("50");
  await expense.getByRole("button", { name: "Cargar el gasto" }).click();
  await expect(expense.getByText("Listo: el agente te devolvió el dinero.")).toBeVisible();
  await heartbeat(ana);
  expect(await wmxnOf(anaAccount)).toBe(50n * U);
  await ana.goto(`${fund}/movimientos`);
  await expect(onScreen(ana, /Le devolví \$50 a Ana por la cancha\./)).toBeVisible();

  // 6. Ana passes those $50 on to Ripio. The panel asks for the address Vender con Ripio gives for her CLABE, and has no
  // Ripio app to deposit in, nor to sell in once passed. A fresh address stands in for Ripio's.
  const ripio = privateKeyToAddress(generatePrivateKey());
  await open(ana, fund);
  await ana.getByRole("link", { name: "Pasar a pesos", exact: true }).click();
  const pesos = ana.getByRole("dialog", { name: "Pasar a pesos" });
  await expect(
    pesos.getByText("Con Vender con Ripio ingresas tu CLABE y Ripio te da una dirección en la red Celo. Pégala aquí y envía: los pesos llegan a tu banco."),
  ).toBeVisible();
  await expect(pesos.getByRole("link", { name: "Vender con Ripio" })).toHaveAttribute(
    "href",
    "https://ramp.ripio.com/offramp?country=MX&chain=42220&token=WMXN&amount=50",
  );
  await expect(pesos.getByText(/app de Ripio/)).toHaveCount(0);
  await pesos.getByLabel("Tu dirección de Ripio").fill(ripio);
  await pesos.getByRole("button", { name: /Pasar \$50 a Ripio/ }).click();
  await expect(pesos.getByRole("status").filter({ hasText: "Pasaste" })).toHaveText(
    "Pasaste $50 a Ripio. Si la dirección es de Vender con Ripio, los pesos llegan solos a tu banco y Ripio te avisa por correo.",
  );
  expect(await wmxnOf(ripio)).toBe(50n * U);
  expect(await wmxnOf(anaAccount)).toBe(0n);

  // 7. In English (EN, from Tu cuenta), Mexico's pesos read "MXN 50", and the times are still Mexico City's.
  await open(ana, `${fund}?p=cuenta`);
  await ana.getByRole("dialog", { name: "Tu cuenta" }).getByRole("button", { name: "English" }).click();
  await expect(ana.getByRole("dialog", { name: "Your account" })).toBeVisible();
  await expect(ana.locator("body > div[lang]")).toHaveAttribute("lang", "en");
  await open(ana, `${fund}/movimientos`);
  await expect(onScreen(ana, /I paid Ana back MXN 50 for “la cancha”\./)).toBeVisible();
  const contributionInEnglish = ana.getByRole("listitem").filter({ hasText: /Ana contributed MXN 100\.26\./ }).filter({ visible: true });
  await expect(contributionInEnglish).toContainText(mexicoCityTime(contributedAt, "en"));
});
