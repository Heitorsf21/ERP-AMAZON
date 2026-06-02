import { describe, expect, it } from "vitest";
import {
  checkRequiredSecrets,
  checkTenantIsolation,
  type StartupEnv,
} from "./startup-checks";

const prodEnvValido: StartupEnv = {
  nodeEnv: "production",
  sessionSecret: "x".repeat(48),
  plataformaSessionSecret: "y".repeat(48),
  configEncryptionKey: "a".repeat(64), // 32 bytes em hex
  tenantIsolation: "enforce",
};

describe("checkTenantIsolation", () => {
  it("não acusa nada com zero ou uma empresa, mesmo com isolamento off", () => {
    expect(checkTenantIsolation(0, "off")).toBeNull();
    expect(checkTenantIsolation(1, undefined)).toBeNull();
  });

  it("acusa FATAL quando há mais de uma empresa e o isolamento não está em enforce", () => {
    const issue = checkTenantIsolation(2, "off");
    expect(issue?.level).toBe("fatal");
    expect(issue?.code).toBe("TENANT_ISOLATION_OFF_MULTI_TENANT");
  });

  it("acusa FATAL quando há mais de uma empresa e a flag está ausente", () => {
    expect(checkTenantIsolation(5, undefined)?.level).toBe("fatal");
  });

  it("não acusa quando há mais de uma empresa e o isolamento está em enforce (case-insensitive)", () => {
    expect(checkTenantIsolation(2, "enforce")).toBeNull();
    expect(checkTenantIsolation(2, "ENFORCE")).toBeNull();
  });
});

describe("checkRequiredSecrets", () => {
  it("não acusa nada em produção com todos os segredos válidos", () => {
    expect(checkRequiredSecrets(prodEnvValido)).toEqual([]);
  });

  it("acusa FATAL em produção quando SESSION_SECRET está ausente", () => {
    const issues = checkRequiredSecrets({ ...prodEnvValido, sessionSecret: "" });
    expect(issues.some((i) => i.level === "fatal" && i.code === "SESSION_SECRET_INVALIDO")).toBe(true);
  });

  it("acusa FATAL em produção quando SESSION_SECRET tem menos de 32 caracteres", () => {
    const issues = checkRequiredSecrets({ ...prodEnvValido, sessionSecret: "curto" });
    expect(issues.some((i) => i.code === "SESSION_SECRET_INVALIDO")).toBe(true);
  });

  it("acusa FATAL em produção quando CONFIG_ENCRYPTION_KEY não é hex de 32 bytes", () => {
    const issues = checkRequiredSecrets({ ...prodEnvValido, configEncryptionKey: "abc" });
    expect(issues.some((i) => i.code === "CONFIG_ENCRYPTION_KEY_INVALIDO")).toBe(true);
  });

  it("acusa FATAL em produção quando PLATAFORMA_SESSION_SECRET está ausente", () => {
    const issues = checkRequiredSecrets({ ...prodEnvValido, plataformaSessionSecret: undefined });
    expect(issues.some((i) => i.code === "PLATAFORMA_SESSION_SECRET_INVALIDO")).toBe(true);
  });

  it("em desenvolvimento não emite FATAL, no máximo WARN", () => {
    const issues = checkRequiredSecrets({ nodeEnv: "development" });
    expect(issues.every((i) => i.level === "warn")).toBe(true);
  });
});
