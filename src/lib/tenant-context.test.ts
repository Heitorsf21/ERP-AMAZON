import { describe, expect, it } from "vitest";
import {
  getEmpresaId,
  getTenantContext,
  runWithTenant,
  type TenantContext,
} from "./tenant-context";

const ctx = (empresaId: string | null, isSuperAdmin = false): TenantContext => ({
  empresaId,
  isSuperAdmin,
  source: "web",
});

describe("tenant-context", () => {
  it("fora de runWithTenant não há contexto", () => {
    expect(getTenantContext()).toBeUndefined();
    expect(getEmpresaId()).toBeNull();
  });

  it("runWithTenant expõe o contexto dentro do escopo", () => {
    const r = runWithTenant(ctx("emp_1"), () => {
      expect(getTenantContext()).toEqual(ctx("emp_1"));
      expect(getEmpresaId()).toBe("emp_1");
      return 42;
    });
    expect(r).toBe(42);
    // E volta a ficar vazio fora do escopo.
    expect(getTenantContext()).toBeUndefined();
  });

  it("contextos aninhados são isolados (inner sobrepõe, outer restaura)", () => {
    runWithTenant(ctx("emp_outer"), () => {
      expect(getEmpresaId()).toBe("emp_outer");
      runWithTenant(ctx("emp_inner"), () => {
        expect(getEmpresaId()).toBe("emp_inner");
      });
      // Voltou ao outer após o escopo interno.
      expect(getEmpresaId()).toBe("emp_outer");
    });
  });

  it("propaga através de awaits (async)", async () => {
    await runWithTenant(ctx("emp_async"), async () => {
      await Promise.resolve();
      expect(getEmpresaId()).toBe("emp_async");
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getEmpresaId()).toBe("emp_async");
    });
  });

  it("empresaId null com superadmin é representável", () => {
    runWithTenant(ctx(null, true), () => {
      expect(getEmpresaId()).toBeNull();
      expect(getTenantContext()?.isSuperAdmin).toBe(true);
    });
  });
});
