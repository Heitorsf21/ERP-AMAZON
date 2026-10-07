import { describe, expect, it } from "vitest";
import { calcularEstadoPush, urlBase64ParaUint8Array } from "./cliente";

describe("urlBase64ParaUint8Array", () => {
  it("decodifica base64url sem padding (formato da chave VAPID)", () => {
    expect(Array.from(urlBase64ParaUint8Array("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("calcularEstadoPush", () => {
  const base = { suportado: true, precisaInstalar: false, permissao: "default" as const, inscritoNestaLoja: false };

  it("iPhone fora do app: instalar primeiro (mesmo sem PushManager)", () => {
    expect(calcularEstadoPush({ ...base, suportado: false, precisaInstalar: true })).toBe("instalar-primeiro");
  });
  it("navegador sem push", () => {
    expect(calcularEstadoPush({ ...base, suportado: false })).toBe("nao-suportado");
  });
  it("permissão negada", () => {
    expect(calcularEstadoPush({ ...base, permissao: "denied" })).toBe("negado");
  });
  it("permitido e inscrito nesta loja = ativo", () => {
    expect(calcularEstadoPush({ ...base, permissao: "granted", inscritoNestaLoja: true })).toBe("ativo");
  });
  it("permitido mas inscrito só na outra loja = desligado (pode ativar aqui)", () => {
    expect(calcularEstadoPush({ ...base, permissao: "granted", inscritoNestaLoja: false })).toBe("desligado");
  });
});
