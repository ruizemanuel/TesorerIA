import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonError, readJson } from "../src/lib/http";

const schema = z.object({ name: z.string() });

function request(body: BodyInit, contentType?: string) {
  return new Request("http://localhost/api/x", { method: "POST", body, headers: contentType ? { "content-type": contentType } : {} });
}

describe("readJson", () => {
  it("reads a body that matches the schema", async () => {
    const result = await readJson(request('{"name":"Ema"}', "application/json"), schema);
    expect(result).toEqual({ ok: true, value: { name: "Ema" } });
  });

  it("refuses anything that is not application/json, which is what a form from another site sends", async () => {
    for (const type of ["application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain", undefined]) {
      const result = await readJson(request('{"name":"Ema"}', type), schema);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(415);
    }
  });

  it("answers 400 to a body that is not JSON or does not match", async () => {
    for (const body of ["{nope", '{"name":5}', "null", "[]"]) {
      const result = await readJson(request(body, "application/json"), schema);
      expect(result.ok, body).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(400);
    }
  });
});

describe("readJson with maxBytes", () => {
  const capped = { maxBytes: 100 };
  const small = JSON.stringify({ name: "Ema" });

  it("reads a body within the cap, and an uncapped call reads any size", async () => {
    expect(await readJson(request(small, "application/json"), schema, capped)).toEqual({ ok: true, value: { name: "Ema" } });
    const big = JSON.stringify({ name: "a".repeat(1_000) });
    expect((await readJson(request(big, "application/json"), schema)).ok).toBe(true);
  });

  it("answers 413 to a body above the cap that declares its length", async () => {
    const declared = new Request("http://localhost/api/x", {
      method: "POST",
      body: small,
      headers: { "content-type": "application/json", "content-length": "101" },
    });
    const result = await readJson(declared, schema, capped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      expect(await result.response.json()).toEqual({ error: "Faltan datos o no son válidos." });
    }
  });

  it("answers 413 to a body above the cap that declares nothing, counting bytes and not characters", async () => {
    for (const name of ["a".repeat(200), "é".repeat(60), "€".repeat(40)]) {
      const result = await readJson(request(JSON.stringify({ name }), "application/json"), schema, capped);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(413);
    }
    // 40 characters of 3 bytes are 120 bytes, but 20 are 60: under the cap.
    expect((await readJson(request(JSON.stringify({ name: "€".repeat(20) }), "application/json"), schema, capped)).ok).toBe(true);
  });

  it("still answers 415 first, and 400 to a body within the cap that is not JSON", async () => {
    const wrongType = await readJson(request("x".repeat(500), "text/plain"), schema, capped);
    expect(!wrongType.ok && wrongType.response.status).toBe(415);
    const notJson = await readJson(request("{nope", "application/json"), schema, capped);
    expect(!notJson.ok && notJson.response.status).toBe(400);
  });
});

describe("jsonError", () => {
  it("answers the status with the message in an error field", async () => {
    const response = jsonError(409, "Ya existe.");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Ya existe." });
  });
});
