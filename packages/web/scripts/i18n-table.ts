// packages/web/scripts/i18n-table.ts
// Writes i18n-table.html: every sentence of the web in Spanish and in English, side by side, for a person to read
// through before a push (spec, 9.3). Functions are called with stand-in values. Not committed.
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

const SAMPLES = ["$ 10.000", "Ana", 2, 3];
const SAMPLES_EN = ["ARS 10,000", "Ana", 2, 3];

function said(value: unknown, samples: unknown[]): string {
  if (typeof value === "function") value = (value as (...args: unknown[]) => unknown)(...samples);
  if (isValidElement(value)) return renderToStaticMarkup(value);
  return String(value);
}

function rows(spanish: unknown, english: unknown, path: string[] = []): string[] {
  if (typeof spanish === "object" && spanish !== null && !Array.isArray(spanish)) {
    return Object.keys(spanish).flatMap((key) => rows((spanish as Record<string, unknown>)[key], (english as Record<string, unknown>)[key], [...path, key]));
  }
  const cell = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const show = (value: unknown, samples: unknown[]) => (Array.isArray(value) ? value.map((v) => said(v, samples)).join(" | ") : said(value, samples));
  return [`<tr><td>${path.join(".")}</td><td>${cell(show(spanish, SAMPLES))}</td><td>${cell(show(english, SAMPLES_EN))}</td></tr>`];
}

const html = `<!doctype html><meta charset="utf-8"><title>TesorerIA: castellano | inglés</title>
<style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse}td{border:1px solid #ccc;padding:6px 8px;vertical-align:top}td:first-child{color:#777;font:12px monospace}</style>
<table><tr><th>clave</th><th>castellano</th><th>inglés</th></tr>${rows(es, en).join("\n")}</table>`;
writeFileSync(new URL("../i18n-table.html", import.meta.url), html);
console.log("i18n-table.html written");
