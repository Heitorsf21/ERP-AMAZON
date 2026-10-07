export type Plataforma = {
  ios: boolean;
  android: boolean;
  standalone: boolean;
  /** iPhone/iPad fora do Safari (Chrome/Firefox/Edge iOS): instalação só pelo Safari. */
  iosSemSafari: boolean;
};

export function detectarPlataforma(
  userAgent: string,
  standalone: boolean,
  maxTouchPoints = 0,
): Plataforma {
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ se anuncia como Mac; o toque denuncia.
  const ipadComoMac = ua.includes("macintosh") && maxTouchPoints > 1;
  const ios = /iphone|ipad|ipod/.test(ua) || ipadComoMac;
  const android = ua.includes("android");
  const iosSemSafari = ios && /crios|fxios|edgios/.test(ua);
  return { ios, android, standalone, iosSemSafari };
}

/** No iOS o push só existe para o app instalado na Tela de Início (16.4+). */
export function precisaInstalarParaPush(p: Plataforma): boolean {
  return p.ios && !p.standalone;
}
