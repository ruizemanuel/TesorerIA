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

describe("jsonError", () => {
  it("answers the status with the message in an error field", async () => {
    const response = jsonError(409, "Ya existe.");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Ya existe." });
  });
});
