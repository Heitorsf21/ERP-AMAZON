import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("encerra a sessão e apaga o chaveiro de lojas do aparelho", async () => {
    const res = await POST();
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("erp_session=;") && /Max-Age=0/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith("erp_lojas=;") && /Max-Age=0/i.test(c))).toBe(true);
  });
});
