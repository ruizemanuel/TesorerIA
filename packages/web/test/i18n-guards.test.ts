// packages/web/test/i18n-guards.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

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

/** Every sentence of a dictionary, with its functions called on stand-in values. */
function sentences(dictionary: unknown): string[] {
  if (typeof dictionary === "string") return [dictionary];
  if (typeof dictionary === "function") {
    const said = (dictionary as (...args: unknown[]) => unknown)("X", "Y", 2, 3);
    return isValidElement(said) ? [renderToStaticMarkup(said)] : [String(said)];
  }
  if (Array.isArray(dictionary)) return dictionary.flatMap(sentences);
  if (typeof dictionary === "object" && dictionary !== null) return Object.values(dictionary).flatMap(sentences);
  return [];
}

describe("no Spanish outside the dictionaries (spec, 11)", () => {
  // Text members wrote isn't in the code; what's here is the Spanish that has a reason to stay in code.
  const ALLOWED = new Set([
    "lib/chat/scripted-model.ts", // the e2e's stand-in model, which runs in Spanish
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

describe("no jargon in either language (spec, 9.2)", () => {
  it("never says gas, hash, wallet, blockchain, token or smart account", () => {
    for (const dictionary of [es, en]) {
      const said = sentences(dictionary).filter((sentence) => /\b(gas|hash(es)?|wallets?|blockchains?|tokens?|smart accounts?)\b/i.test(sentence));
      expect(said).toEqual([]);
    }
  });
});
