import { describe, expect, it } from "vitest";
import { detectarPlataforma, precisaInstalarParaPush } from "./plataforma";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

describe("detectarPlataforma", () => {
  it("iPhone no Safari, fora do app: precisa instalar para receber push", () => {
    const p = detectarPlataforma(IPHONE_SAFARI, false, 5);
    expect(p).toMatchObject({ ios: true, android: false, standalone: false, iosSemSafari: false });
    expect(precisaInstalarParaPush(p)).toBe(true);
  });

  it("iPhone com o app instalado: push liberado", () => {
    expect(precisaInstalarParaPush(detectarPlataforma(IPHONE_SAFARI, true, 5))).toBe(false);
  });

  it("Chrome no iPhone é marcado (instalação só pelo Safari)", () => {
    expect(detectarPlataforma(IPHONE_CHROME, false, 5).iosSemSafari).toBe(true);
  });

  it("iPad se anuncia como Mac, mas tem toque", () => {
    expect(detectarPlataforma(IPAD_COMO_MAC, false, 5).ios).toBe(true);
    expect(detectarPlataforma(IPAD_COMO_MAC, false, 0).ios).toBe(false);
  });

  it("Android e desktop não precisam instalar para push", () => {
    expect(detectarPlataforma(ANDROID, false).android).toBe(true);
    expect(precisaInstalarParaPush(detectarPlataforma(ANDROID, false))).toBe(false);
    expect(precisaInstalarParaPush(detectarPlataforma(WINDOWS, false))).toBe(false);
  });
});
