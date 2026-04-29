import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("amazon-sp-api Listings guard", () => {
  it("mantem Listings Items somente leitura", () => {
    const source = readFileSync("src/lib/amazon-sp-api.ts", "utf8");
    const forbidden = [
      "patch" + "ListingsItem",
      "put" + "ListingsItem",
      "delete" + "ListingsItem",
    ];

    for (const token of forbidden) {
      expect(source).not.toContain(`function ${token}`);
      expect(source).not.toContain(`export async function ${token}`);
    }
  });
});
