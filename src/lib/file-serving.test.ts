import { describe, expect, it } from "vitest";
import { resolveFileServeHeaders, sanitizeFilename } from "./file-serving";

describe("sanitizeFilename", () => {
  it("remove aspas, CRLF e controle (anti header injection)", () => {
    expect(sanitizeFilename('a"b\r\nc')).toBe("abc");
  });

  it("fallback quando vazio", () => {
    expect(sanitizeFilename("   ")).toBe("arquivo");
  });
});

describe("resolveFileServeHeaders", () => {
  it("PDF sem forçar download → inline + content-type pdf", () => {
    const h = resolveFileServeHeaders("application/pdf", "nf.pdf", false);
    expect(h.contentType).toBe("application/pdf");
    expect(h.disposition).toBe('inline; filename="nf.pdf"');
  });

  it("HTML NUNCA é inline (anti stored-XSS) → attachment + octet-stream", () => {
    const h = resolveFileServeHeaders("text/html", "x.html", false);
    expect(h.contentType).toBe("application/octet-stream");
    expect(h.disposition.startsWith("attachment")).toBe(true);
  });

  it("SVG NUNCA é inline (script embutido)", () => {
    const h = resolveFileServeHeaders("image/svg+xml", "x.svg", false);
    expect(h.disposition.startsWith("attachment")).toBe(true);
    expect(h.contentType).toBe("application/octet-stream");
  });

  it("forceDownload sempre attachment, mesmo para PDF", () => {
    const h = resolveFileServeHeaders("application/pdf", "nf.pdf", true);
    expect(h.disposition.startsWith("attachment")).toBe(true);
  });

  it("ignora parâmetros do mime (charset) ao decidir", () => {
    const h = resolveFileServeHeaders("application/pdf; charset=utf-8", "nf.pdf", false);
    expect(h.contentType).toBe("application/pdf");
  });
});
