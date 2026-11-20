// packages/web/test/i18n-guards.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../src/lib/countries";
import type { Dictionary } from "../src/lib/i18n/es";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { neutral } from "../src/lib/i18n/neutral";

const SRC = join(import.meta.dirname, "../src");
const SPANISH = /[áéíóúñÁÉÍÓÚÑ¿¡]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without its comments: `//` to the end of the line, and `/* … *\/` blocks. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** What a sentence of a dictionary says: a string as it is, React rendered, a list line by line. */
function spoken(said: unknown): string[] {
  if (Array.isArray(said)) return said.flatMap(spoken);
  return isValidElement(said) ? [renderToStaticMarkup(said)] : [String(said)];
}

/**
 * Every sentence of a dictionary with the path it's at, its functions called on `argsFor(path)`: stand-in values
 * unless the path says otherwise.
 */
function sentencesAt(dictionary: unknown, argsFor: (path: string) => unknown[] = () => STAND_INS, path = ""): Array<[path: string, sentence: string]> {
  if (typeof dictionary === "string") return [[path, dictionary]];
  if (typeof dictionary === "function") return spoken((dictionary as (...args: unknown[]) => unknown)(...argsFor(path))).map((s) => [path, s]);
  if (Array.isArray(dictionary)) return dictionary.flatMap((inner) => sentencesAt(inner, argsFor, path));
  if (typeof dictionary === "object" && dictionary !== null) {
    return Object.entries(dictionary).flatMap(([key, inner]) => sentencesAt(inner, argsFor, path === "" ? key : `${path}.${key}`));
  }
  return [];
}
const STAND_INS = ["X", "Y", 2, 3];

/** Every sentence of a dictionary, with its functions called on stand-in values. */
const sentences = (dictionary: unknown): string[] => sentencesAt(dictionary).map(([, sentence]) => sentence);

/** The words of the interface that are jargon (spec, 9.2). */
const JARGON = /\b(gas|hash(es)?|wallets?|blockchains?|tokens?|smart accounts?)\b/i;
const jargonIn = (said: string[]) => said.filter((sentence) => JARGON.test(sentence));

describe("no Spanish outside the dictionaries (spec, 11)", () => {
  // Text members wrote isn't in the code; what's here is the Spanish that has a reason to stay in code.
  const ALLOWED = new Set([
    "lib/chat/scripted-model.ts", // the e2e's stand-in model, which runs in Spanish
    "lib/countries.ts", // each country's words in Spanish (its clock's name, "hora de Ciudad de México"): data of the table, not UI text
    "lib/chat/instructions.ts", // the Spanish variant of the chat model's instructions: a prompt, not UI, pinned literally by chat-request.test.ts
  ]);

  it("finds no accented Spanish in the code", () => {
    const leaks = files(SRC)
      .filter((path) => !relative(SRC, path).replaceAll("\\", "/").startsWith("lib/i18n/"))
      .filter((path) => !ALLOWED.has(relative(SRC, path).replaceAll("\\", "/")))
      .flatMap((path) =>
        withoutComments(readFileSync(path, "utf8"))
          .split("\n")
          .flatMap((line, i) => (SPANISH.test(line) ? [`${relative(SRC, path)}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(leaks).toEqual([]);
  });

  it("finds no Spanish in the English dictionary, but for the Ripio app's own buttons", () => {
    const RIPIO_BUTTONS = /Depositar/g;
    const leaks = sentences(en).filter((sentence) => SPANISH.test(sentence.replace(RIPIO_BUTTONS, "")));
    expect(leaks).toEqual([]);
  });
});

describe("no jargon in any language (spec, 9.2)", () => {
  it("never says gas, hash, wallet, blockchain, token or smart account", () => {
    for (const dictionary of [es, en]) expect(jargonIn(sentences(dictionary))).toEqual([]);
  });

  it("keeps jargon out of the neutral dictionary", () => {
    expect(jargonIn(sentences(neutral))).toEqual([]);
  });
});

describe("the neutral Spanish (spec, 7)", () => {
  /**
   * The words of es.tsx that end in a stressed á, é or í (and an s) and aren't voseo, and those the neutral Spanish
   * adds: tú's own forms (estás, podrás), the agent's first person in the past (pasé, devolví), and plain words (más,
   * aquí). "acá" is left out on purpose: the neutral says "aquí".
   */
  const ALLOWED = new Set([
    // From es.tsx
    "ahí",
    "cambié",
    "cargué",
    "cerré",
    "demás",
    "deposité",
    "después",
    "devolví",
    "está",
    "estás",
    "esté",
    "guardé",
    "más",
    "pasé",
    "qué",
    "revisé",
    "sí",
    // The neutral's own
    "aquí",
    "envié",
    "podrás",
  ]);
  /** The voseo of es.tsx that carries no stress mark: its imperatives with a pronoun, and vos and sos. */
  const VOSEO_CLITICS = new Set([
    "cargalos",
    "contame",
    "copiala",
    "escribila",
    "escribilo",
    "escribinos",
    "pedile",
    "pegala",
    "preguntale",
    "preguntame",
    "sumate",
    "vendelos",
    "vos",
    "sos",
  ]);
  /** Rioplatense words that the rest of Latin America says otherwise (plata is dinero, mail is correo). */
  const RIOPLATENSE = new Set(["plata", "acá", "che", "laburo", "guita", "boludo", "colectivo", "ojo", "mail", "reintegro", "reintegros", "andando"]);

  const words = (said: string[]) => said.flatMap((sentence) => sentence.toLowerCase().match(/\p{L}+/gu) ?? []);
  const voseoIn = (said: string[]) => [
    ...new Set(words(said).filter((word) => (/[áéí]s?$/.test(word) && !ALLOWED.has(word)) || VOSEO_CLITICS.has(word))),
  ];

  it("finds the voseo where there is some: in the Rioplatense dictionary", () => {
    expect(voseoIn(sentences(es))).toEqual(expect.arrayContaining(["confirmá", "tenés", "sumate", "vos"]));
  });

  it("has no voseo in the neutral dictionary", () => {
    expect(voseoIn(sentences(neutral))).toEqual([]);
  });

  it("says dinero, not plata, and none of the Rioplatense words", () => {
    expect([...new Set(words(sentences(neutral)).filter((word) => RIOPLATENSE.has(word)))]).toEqual([]);
    expect(neutral.home.title).toBe("El dinero del grupo, sin tesorero.");
  });

  it("names Ripio's buttons as the ramp and its app show them", () => {
    expect(neutral.cashOut.sellWithRipio).toBe("Vender con Ripio");
    expect(neutral.cashOut.sellIntro("CLABE")).toContain("Vender con Ripio");
    expect(neutral.cashOut.depositInstructions("wMXN")).toContain("Depositar");
  });
});

describe("no Argentina in a page of Mexico (spec, 4)", () => {
  const MEXICO = COUNTRIES.MX;
  /**
   * The sentences that may name Ripio's app or wARS because a page shows them only where the country has Ripio's
   * app (`ripioApp`) or the fund has a dollar: a Mexican fund never shows them.
   */
  const ONLY_WITH_THE_APP_OR_A_DOLLAR = new Set([
    "contribute.ripioWithdraw", // Aportar shows it only with `ripioApp`, else contribute.rampOnly
    "cashOut.depositInstructions", // Pasar a pesos shows it only with `ripioApp`
  ]);
  const ARGENTINA = /wARS|\bARS\b|CBU|CVU|\balias\b|Argentin|app de Ripio|Ripio app|\bla app\b|\bthe app\b/i;

  /** What each country-bound sentence is said with in a page of Mexico: its words, no Ripio app and no dollar. */
  const inMexico = (dictionary: Dictionary) => {
    const words = MEXICO.words[dictionary.locale];
    const args: Record<string, unknown[]> = {
      "cashOut.sellIntro": [words.bankAccount],
      "cashOut.depositInstructions": [words.token],
      "cashOut.passed": ["X", MEXICO.ripioApp],
      "contribute.ripioWithdraw": [words.token],
      "contribute.rampOnly": [words.token],
      "chat.brief.now": ["X", "3", words.timeName],
      "home.steps": [MEXICO.currency.dollar !== null],
    };
    return sentencesAt(dictionary, (path) => args[path] ?? STAND_INS).filter(([path]) => !ONLY_WITH_THE_APP_OR_A_DOLLAR.has(path));
  };

  it("names neither wARS, the CBU, Argentina nor Ripio's app, in neutral Spanish or in English", () => {
    for (const dictionary of [neutral, en]) {
      expect(inMexico(dictionary).filter(([, sentence]) => ARGENTINA.test(sentence))).toEqual([]);
    }
  });

  it("would find them in an Argentine page", () => {
    const words = COUNTRIES.AR.words.es;
    expect(ARGENTINA.test(es.cashOut.sellIntro(words.bankAccount))).toBe(true);
    expect(ARGENTINA.test(es.chat.brief.now("X", "3", words.timeName))).toBe(true);
  });
});
