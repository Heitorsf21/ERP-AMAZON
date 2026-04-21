// Helper único para chamadas à API interna. Lê o corpo de erro uma única vez
// (evita "Body already read") e propaga a mensagem do backend para a UI.
export async function fetchJSON<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const texto = await resp.text();
  const body = texto ? JSON.parse(texto) : null;
  if (!resp.ok) {
    const msg =
      (body &&
        typeof body === "object" &&
        (("erro" in body && body.erro) || ("error" in body && body.error))) ||
      `erro ${resp.status}`;
    throw new Error(String(msg));
  }
  return body as T;
}
