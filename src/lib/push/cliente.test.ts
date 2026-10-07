import { describe, expect, it } from "vitest";
import { calcularEstadoPush, decidirSaida, urlBase64ParaUint8Array } from "./cliente";

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

describe("decidirSaida", () => {
  const inscricao = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", loja: "MundoFS" };

  it("quem não renderiza o diálogo (ex.: 'Trocar de conta') sai direto, mantendo os avisos", () => {
    expect(decidirSaida({ perguntarAvisos: false, inscricao, appInstalado: true })).toEqual({
      acao: "encerrar",
    });
  });
  it("sem inscrição desta loja neste aparelho, sai direto", () => {
    expect(decidirSaida({ perguntarAvisos: true, inscricao: null, appInstalado: true })).toEqual({
      acao: "encerrar",
    });
  });
  it("inscrito e com diálogo: pergunta; no app instalado o padrão é continuar", () => {
    expect(decidirSaida({ perguntarAvisos: true, inscricao, appInstalado: true })).toEqual({
      acao: "perguntar",
      pergunta: { ...inscricao, padraoContinuar: true },
    });
  });
  it("inscrito numa aba comum do navegador: padrão é parar", () => {
    expect(decidirSaida({ perguntarAvisos: true, inscricao, appInstalado: false })).toEqual({
      acao: "perguntar",
      pergunta: { ...inscricao, padraoContinuar: false },
    });
  });
});
