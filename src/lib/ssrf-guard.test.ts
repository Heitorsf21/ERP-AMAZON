import { describe, expect, it } from "vitest";
import {
  assertAmazonEndpoint,
  assertSafeHttpUrl,
  isAllowedAmazonHost,
  isPrivateOrReservedHost,
} from "./ssrf-guard";

describe("isPrivateOrReservedHost", () => {
  it("detecta loopback, link-local/metadata e ranges privados", () => {
    expect(isPrivateOrReservedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("localhost")).toBe(true);
    expect(isPrivateOrReservedHost("169.254.169.254")).toBe(true); // metadata cloud
    expect(isPrivateOrReservedHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedHost("::1")).toBe(true);
    expect(isPrivateOrReservedHost("metadata.google.internal")).toBe(true);
  });

  it("não marca hosts públicos como privados", () => {
    expect(isPrivateOrReservedHost("sellingpartnerapi-na.amazon.com")).toBe(false);
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
  });
});

describe("isAllowedAmazonHost", () => {
  it("aceita hosts oficiais da Amazon", () => {
    expect(isAllowedAmazonHost("sellingpartnerapi-na.amazon.com")).toBe(true);
    expect(isAllowedAmazonHost("advertising-api.amazon.com")).toBe(true);
    expect(isAllowedAmazonHost("api.amazon.com")).toBe(true);
  });

  it("rejeita hosts forjados (suffix spoofing)", () => {
    expect(isAllowedAmazonHost("amazon.com.evil.com")).toBe(false);
    expect(isAllowedAmazonHost("fakeamazon.com")).toBe(false);
    expect(isAllowedAmazonHost("evil.com")).toBe(false);
  });
});

describe("assertAmazonEndpoint", () => {
  it("retorna a URL para endpoint Amazon válido", () => {
    expect(assertAmazonEndpoint("https://sellingpartnerapi-na.amazon.com").host).toBe(
      "sellingpartnerapi-na.amazon.com",
    );
  });

  it("lança para host não-Amazon (impede vazar o token LWA)", () => {
    expect(() => assertAmazonEndpoint("https://evil.example.com")).toThrow();
  });

  it("lança para IP interno", () => {
    expect(() => assertAmazonEndpoint("http://169.254.169.254")).toThrow();
  });
});

describe("assertSafeHttpUrl (genérico — ex: WAHA)", () => {
  it("aceita http(s), inclusive localhost (WAHA roda em 127.0.0.1)", () => {
    expect(assertSafeHttpUrl("http://127.0.0.1:3002").port).toBe("3002");
  });

  it("rejeita esquemas perigosos", () => {
    expect(() => assertSafeHttpUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeHttpUrl("gopher://x")).toThrow();
  });

  it("com allowlist, rejeita host fora da lista", () => {
    expect(() =>
      assertSafeHttpUrl("http://10.0.0.9", { allowedHosts: ["127.0.0.1:3002"] }),
    ).toThrow();
    expect(
      assertSafeHttpUrl("http://127.0.0.1:3002", { allowedHosts: ["127.0.0.1:3002"] }).host,
    ).toBe("127.0.0.1:3002");
  });
});
