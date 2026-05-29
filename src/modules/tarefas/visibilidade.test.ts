import { describe, expect, it } from "vitest";
import {
  orVisibilidadeTarefa,
  podeEditarTarefa,
  podeVerTarefa,
} from "./visibilidade";

describe("podeVerTarefa", () => {
  it("tarefa EMPRESA é visível para qualquer usuário", () => {
    expect(
      podeVerTarefa({ visibilidade: "EMPRESA", responsavelId: null }, "u1"),
    ).toBe(true);
    expect(
      podeVerTarefa({ visibilidade: "EMPRESA", responsavelId: "u2" }, "u1"),
    ).toBe(true);
  });

  it("tarefa PESSOAL só é visível ao dono", () => {
    expect(
      podeVerTarefa({ visibilidade: "PESSOAL", responsavelId: "u1" }, "u1"),
    ).toBe(true);
    expect(
      podeVerTarefa({ visibilidade: "PESSOAL", responsavelId: "u2" }, "u1"),
    ).toBe(false);
    // Sem dono definido, ninguém vê a PESSOAL.
    expect(
      podeVerTarefa({ visibilidade: "PESSOAL", responsavelId: null }, "u1"),
    ).toBe(false);
  });
});

describe("podeEditarTarefa", () => {
  it("segue a mesma regra de visualização (PESSOAL só o dono)", () => {
    expect(
      podeEditarTarefa({ visibilidade: "PESSOAL", responsavelId: "u1" }, "u1"),
    ).toBe(true);
    expect(
      podeEditarTarefa({ visibilidade: "PESSOAL", responsavelId: "u2" }, "u1"),
    ).toBe(false);
    expect(
      podeEditarTarefa({ visibilidade: "EMPRESA", responsavelId: "u2" }, "u1"),
    ).toBe(true);
  });
});

describe("orVisibilidadeTarefa", () => {
  it("monta o filtro Prisma de visibilidade do usuário", () => {
    expect(orVisibilidadeTarefa("u1")).toEqual([
      { visibilidade: "EMPRESA" },
      { visibilidade: "PESSOAL", responsavelId: "u1" },
    ]);
  });
});
