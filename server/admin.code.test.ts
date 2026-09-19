import { describe, expect, it } from "vitest";
import { validateAdminCode } from "./admin";

describe("admin code", () => {
  it("accepts the configured server-side code and rejects other values", () => {
    expect(validateAdminCode("2082")).toBe(true);
    expect(validateAdminCode("0000")).toBe(false);
    expect(validateAdminCode("2082 ")).toBe(false);
  });
});
