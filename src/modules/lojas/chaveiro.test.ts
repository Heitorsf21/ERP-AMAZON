import { beforeAll, describe, expect, it } from "vitest";
import {
  assinarChaveiro,
  baseParaVincular,
  chaveiroValido,
  guardarContas,
  lerChaveiro,
  MAX_CONTAS,
  temConta,
  tirarConta,
  VALIDADE_CHAVEIRO_SEG,
} from "./chaveiro";

const AGORA = 1_800_000_000;

beforeAll(() => {
  process.env.SESSION_SECRET = "c".repeat(48);
});

describe("guardarContas", () => {
  it("cria o chaveiro do aparelho com as contas provadas", () => {
    const ch = guardarContas(null, [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 2 }], AGORA);
    expect(ch).toEqual({
      contas: [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 2 }],
      exp: AGORA + VALIDADE_CHAVEIRO_SEG,
    });
  });

  it("conta já guardada só atualiza a versão (sem duplicar)", () => {
    const antes = guardarContas(null, [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }], AGORA);
    const depois = guardarContas(antes, [{ uid: "u-udn", v: 3 }], AGORA + 10);
    expect(depois.contas).toEqual([{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 3 }]);
    expect(depois.exp).toBe(AGORA + 10 + VALIDADE_CHAVEIRO_SEG);
  });

  it(`guarda no máximo ${MAX_CONTAS} contas (sai a mais antiga)`, () => {
    let ch = guardarContas(null, [{ uid: "u0", v: 0 }], AGORA);
    for (let i = 1; i <= MAX_CONTAS; i++) ch = guardarContas(ch, [{ uid: `u${i}`, v: 0 }], AGORA);
    expect(ch.contas).toHaveLength(MAX_CONTAS);
    expect(temConta(ch, "u0")).toBe(false);
    expect(temConta(ch, `u${MAX_CONTAS}`)).toBe(true);
  });
});

describe("tirarConta", () => {
  it("tira a conta do aparelho", () => {
    const ch = guardarContas(null, [{ uid: "a", v: 0 }, { uid: "b", v: 0 }, { uid: "c", v: 0 }], AGORA);
    expect(tirarConta(ch, "b")?.contas.map((c) => c.uid)).toEqual(["a", "c"]);
  });

  it("sobrando uma conta só, o chaveiro some (não há o que trocar)", () => {
    const ch = guardarContas(null, [{ uid: "a", v: 0 }, { uid: "b", v: 0 }], AGORA);
    expect(tirarConta(ch, "b")).toBeNull();
  });
});

describe("chaveiroValido", () => {
  it("recusa formato estranho, vencido ou grande demais", () => {
    expect(chaveiroValido(null, AGORA)).toBeNull();
    expect(chaveiroValido({ contas: "x", exp: AGORA + 1 }, AGORA)).toBeNull();
    expect(chaveiroValido({ contas: [{ uid: 1, v: 0 }], exp: AGORA + 1 }, AGORA)).toBeNull();
    expect(chaveiroValido({ contas: [{ uid: "a", v: 0 }], exp: AGORA - 1 }, AGORA)).toBeNull();
    const muitas = Array.from({ length: MAX_CONTAS + 1 }, (_, i) => ({ uid: `u${i}`, v: 0 }));
    expect(chaveiroValido({ contas: muitas, exp: AGORA + 1 }, AGORA)).toBeNull();
  });
});

describe("assinarChaveiro / lerChaveiro", () => {
  it("o cookie assinado volta igual; adulterado não vale", async () => {
    const ch = guardarContas(null, [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 1 }], Math.floor(Date.now() / 1000));
    const token = await assinarChaveiro(ch);
    expect(await lerChaveiro(token)).toEqual(ch);
    const [corpo, assinatura] = token.split(".");
    const forjado = `${Buffer.from(JSON.stringify({ ...ch, contas: [...ch.contas, { uid: "u-x", v: 0 }] })).toString("base64url")}.${assinatura}`;
    expect(corpo).toBeTruthy();
    expect(await lerChaveiro(forjado)).toBeNull();
    expect(await lerChaveiro(undefined)).toBeNull();
  });
});

describe("baseParaVincular", () => {
  const dono = guardarContas(null, [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }], AGORA);

  it("dono do chaveiro vinculando mais uma loja: aproveita o chaveiro", () => {
    expect(baseParaVincular(dono, "u-mfs", 0)).toBe(dono);
  });

  it("outra pessoa no mesmo aparelho: começa do zero (não herda as lojas do dono)", () => {
    expect(baseParaVincular(dono, "u-socio", 0)).toBeNull();
  });

  it("dono que trocou a senha depois: começa do zero", () => {
    expect(baseParaVincular(dono, "u-mfs", 1)).toBeNull();
  });

  it("sem chaveiro: começa do zero", () => {
    expect(baseParaVincular(null, "u-mfs", 0)).toBeNull();
  });
});
