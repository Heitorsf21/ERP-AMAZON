import { describe, it, expect } from "vitest";
import { gerarTokenConvite, hashTokenConvite, CONVITE_TTL_MS } from "./convite";

describe("convite token", () => {
  it("gera token cru + hash SHA-256 consistente", () => {
    const { rawToken, tokenHash } = gerarTokenConvite();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url, >=32 bytes
    expect(tokenHash).toHaveLength(64);               // sha256 hex
    expect(hashTokenConvite(rawToken)).toBe(tokenHash);
  });
  it("tokens sao unicos", () => {
    expect(gerarTokenConvite().rawToken).not.toBe(gerarTokenConvite().rawToken);
  });
  it("TTL de 7 dias", () => {
    expect(CONVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
