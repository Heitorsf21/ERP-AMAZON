import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { dbMock, sendMock } = vi.hoisted(() => ({
  dbMock: {
    pushEnvio: { create: vi.fn(), update: vi.fn() },
    pushDispositivo: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    usuario: { findMany: vi.fn() },
  },
  sendMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("web-push", () => ({ default: { sendNotification: sendMock } }));

import { entregar, enviarPush, getVapidConfig, reservarEnvio, TipoPushEnvio } from "./envio";
import { montarPayloadVenda } from "./regras";

const CFG = { publicKey: "pub", privateKey: "priv", subject: "https://erp.mundofs.cloud" };
const PAYLOAD = montarPayloadVenda({
  loja: "MundoFS",
  valorCentavos: 7700,
  estimado: true,
  amazonOrderId: "702-0000000-0000001",
  empresaId: "mundofs",
});
const disp = (id: string, endpoint: string, falhasConsecutivas = 0) => ({
  id,
  endpoint,
  p256dh: "p",
  auth: "a",
  falhasConsecutivas,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.pushEnvio.create.mockResolvedValue({ id: "env1" });
  dbMock.pushEnvio.update.mockResolvedValue({});
  dbMock.pushDispositivo.update.mockResolvedValue({});
  dbMock.pushDispositivo.deleteMany.mockResolvedValue({ count: 1 });
  dbMock.pushDispositivo.findMany.mockResolvedValue([]);
  dbMock.usuario.findMany.mockResolvedValue([{ id: "u1" }]);
  sendMock.mockResolvedValue({ statusCode: 201 });
});

describe("getVapidConfig", () => {
  it("sem chaves, push fica desligado", () => {
    expect(getVapidConfig({})).toBeNull();
  });
  it("subject padrão é o domínio do ERP (sem e-mail pessoal)", () => {
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })?.subject).toBe(
      "https://erp.mundofs.cloud",
    );
  });
});

describe("reservarEnvio", () => {
  it("dedupe já usado (P2002) devolve null = já avisado", async () => {
    dbMock.pushEnvio.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    expect(
      await reservarEnvio({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD }),
    ).toBeNull();
  });
});

describe("entregar", () => {
  it("vai só para aparelhos ativos DA EMPRESA da venda que querem vendas", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm.googleapis.com/fcm/send/1")]);
    const r = await entregar({ empresaId: "udncd", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: "udncd", ativo: true, receberVendas: true, usuarioId: { in: ["u1"] } },
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      { endpoint: "https://fcm.googleapis.com/fcm/send/1", keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(PAYLOAD),
      expect.objectContaining({ TTL: 3600, urgency: "high" }),
    );
    expect(r).toEqual({ destinos: 1, ok: 1, falhas: 0 });
  });

  it("usuário desativado (ou de outra empresa) deixa de receber os avisos de venda", async () => {
    dbMock.usuario.findMany.mockResolvedValue([{ id: "u2" }]);
    await entregar({ empresaId: "udncd", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.usuario.findMany).toHaveBeenCalledWith({
      where: { empresaId: "udncd", ativo: true },
      select: { id: true },
    });
    expect(dbMock.pushDispositivo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usuarioId: { in: ["u2"] } }) }),
    );
  });

  it("teste vai só para os aparelhos do próprio usuário", async () => {
    await entregar({ empresaId: "mundofs", payload: PAYLOAD, usuarioId: "u1", cfg: CFG });
    expect(dbMock.pushDispositivo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "mundofs", ativo: true, usuarioId: "u1" } }),
    );
  });

  it("inscrição expirada (410) é apagada em todas as lojas daquele aparelho", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm.googleapis.com/fcm/send/1")]);
    sendMock.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.deleteMany).toHaveBeenCalledWith({ where: { endpoint: "https://fcm.googleapis.com/fcm/send/1" } });
    expect(r).toEqual({ destinos: 1, ok: 0, falhas: 1 });
  });

  it("5ª falha seguida desativa o aparelho", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm.googleapis.com/fcm/send/1", 4)]);
    sendMock.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { falhasConsecutivas: 5, ativo: false },
    });
  });

  it("sem VAPID não consulta nem envia", async () => {
    const r = await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: null });
    expect(dbMock.pushDispositivo.findMany).not.toHaveBeenCalled();
    expect(r).toEqual({ destinos: 0, ok: 0, falhas: 0 });
  });

  it("endpoint fora dos serviços de push conhecidos não recebe POST e é desativado (anti-SSRF)", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([
      disp("d9", "https://169.254.169.254/latest/meta-data"),
    ]);
    const r = await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: CFG });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.pushDispositivo.update).toHaveBeenCalledWith({
      where: { id: "d9" },
      data: { ativo: false },
    });
    expect(r).toEqual({ destinos: 1, ok: 0, falhas: 1 });
  });
});

describe("enviarPush", () => {
  it("pedido já avisado não entrega de novo", async () => {
    dbMock.pushEnvio.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    const r = await enviarPush({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD, cfg: CFG });
    expect(r.duplicado).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("registra ENVIADO com a contagem", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm.googleapis.com/fcm/send/1")]);
    await enviarPush({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushEnvio.update).toHaveBeenCalledWith({
      where: { id: "env1" },
      data: expect.objectContaining({ status: "ENVIADO", enviadosOk: 1, falhas: 0 }),
    });
  });
});
