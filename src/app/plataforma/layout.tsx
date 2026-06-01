export const dynamic = "force-dynamic";

export default function PlataformaLayout({ children }: { children: React.ReactNode }) {
  // Layout NEUTRO de proposito: /plataforma/login e filha de /plataforma, entao
  // um guard aqui causaria loop de redirect. Cada PAGINA protegida chama
  // getPlataformaSession() e redireciona (ver page.tsx e empresas/nova/page.tsx).
  return <div style={{ minHeight: "100vh" }}>{children}</div>;
}
