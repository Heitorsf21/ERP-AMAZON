/* Atlas Seller — service worker.
 * SEM handler de fetch e SEM cache: dados financeiros nunca ficam velhos e não há
 * risco de cache cruzado entre contas. Só cuida de notificações push. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : "" };
  }
  const titulo = dados.title || "Atlas Seller";
  // iOS cancela a inscrição de quem recebe push sem exibir notificação:
  // SEMPRE chamar showNotification.
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.body || "",
      icon: dados.icon || "/icons/icon-192.png",
      badge: dados.badge || "/icons/badge-96.png",
      tag: dados.tag || undefined,
      renotify: Boolean(dados.tag),
      data: { url: dados.url || "/vendas" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if ("focus" in janela) {
          await janela.focus();
          if ("navigate" in janela) await janela.navigate(destino);
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // O navegador trocou a inscrição: re-inscreve com a mesma chave pública e
  // registra de novo para a loja da sessão atual (cookie vai junto, mesma origem).
  event.waitUntil(
    (async () => {
      const resp = await fetch("/api/push/config", { credentials: "same-origin" });
      if (!resp.ok) return;
      const { enabled, publicKey } = await resp.json();
      if (!enabled || !publicKey) return;
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const bruto = atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
      const chave = Uint8Array.from(bruto, (c) => c.charCodeAt(0));
      const nova = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });
      const json = nova.toJSON();
      await fetch("/api/push/dispositivos", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: nova.endpoint, keys: json.keys }),
      });
    })(),
  );
});
