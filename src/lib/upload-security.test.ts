import { describe, expect, it } from "vitest";
import {
  ArquivoImportacaoInvalidoError,
  normalizarNomeArquivoImportacao,
  validarArquivoXlsxUpload,
  validarBufferXlsx,
} from "./upload-security";

describe("upload-security", () => {
  it("aceita metadados e assinatura de xlsx valido", () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);

    expect(() => validarBufferXlsx(buffer, "reports_sales.xlsx")).not.toThrow();
  });

  it("rejeita extensao ou assinatura invalida", () => {
    expect(() =>
      validarArquivoXlsxUpload({
        name: "relatorio.csv",
        size: 10,
        type: "text/csv",
      }),
    ).toThrow(ArquivoImportacaoInvalidoError);

    expect(() =>
      validarBufferXlsx(Buffer.from("not-xlsx"), "reports_sales.xlsx"),
    ).toThrow(ArquivoImportacaoInvalidoError);
  });

  it("rejeita arquivo acima do limite configurado", () => {
    expect(() =>
      validarArquivoXlsxUpload(
        {
          name: "reports_sales.xlsx",
          size: 11,
          type: "",
        },
        10,
      ),
    ).toThrow("Arquivo muito grande");
  });

  it("normaliza nomes recebidos do upload", () => {
    expect(normalizarNomeArquivoImportacao("../bad:name.xlsx")).toBe(
      "bad_name.xlsx",
    );
  });
});
