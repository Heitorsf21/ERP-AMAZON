// Gera os ícones do app instalável (PWA) a partir do símbolo do Atlas.
// Uso: node scripts/gerar-icones-pwa.mjs (rodar de novo só se o logo mudar).
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const ORIGEM = "src/app/icon.png"; // 512x512, símbolo sobre fundo transparente
const DESTINO = "public/icons";
const FUNDO = "#030712"; // navy da sidebar/tema
const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 };

async function iconeSobreFundo(tamanho, escala, saida) {
  const lado = Math.round(tamanho * escala);
  const simbolo = await sharp(ORIGEM)
    .resize(lado, lado, { fit: "contain", background: TRANSPARENTE })
    .png()
    .toBuffer();
  await sharp({
    create: { width: tamanho, height: tamanho, channels: 4, background: FUNDO },
  })
    .composite([{ input: simbolo, gravity: "center" }])
    .png()
    .toFile(saida);
}

// Ícone pequeno da barra de status do Android: silhueta branca sobre transparente.
async function badgeMonocromatico(tamanho, saida) {
  const miolo = Math.round(tamanho * 0.75);
  const margem = Math.floor((tamanho - miolo) / 2);
  const alpha = await sharp(ORIGEM)
    .resize(miolo, miolo, { fit: "contain", background: TRANSPARENTE })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  await sharp({
    create: { width: miolo, height: miolo, channels: 3, background: "#ffffff" },
  })
    .joinChannel(alpha, { raw: { width: miolo, height: miolo, channels: 1 } })
    .extend({
      top: margem,
      bottom: tamanho - miolo - margem,
      left: margem,
      right: tamanho - miolo - margem,
      background: TRANSPARENTE,
    })
    .png()
    .toFile(saida);
}

await mkdir(DESTINO, { recursive: true });
await iconeSobreFundo(192, 0.78, `${DESTINO}/icon-192.png`);
await iconeSobreFundo(512, 0.78, `${DESTINO}/icon-512.png`);
// maskable: o Android recorta em círculo/squircle → símbolo dentro da zona segura (~60%).
await iconeSobreFundo(512, 0.6, `${DESTINO}/maskable-512.png`);
await iconeSobreFundo(180, 0.78, "src/app/apple-icon.png");
await badgeMonocromatico(96, `${DESTINO}/badge-96.png`);
console.log("Ícones gerados em", DESTINO, "e src/app/apple-icon.png");
