import { redirect } from "next/navigation";
import Link from "next/link";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { listarEmpresas } from "@/modules/plataforma/empresas";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");
  const empresas = await listarEmpresas();
  return (
    <div style={{ maxWidth: 880, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Empresas</h1>
        <Link href="/plataforma/empresas/nova">+ Nova empresa</Link>
      </div>
      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead><tr><th>Nome</th><th>Slug</th><th>Usuários</th><th>Amazon</th><th>Status</th></tr></thead>
        <tbody>
          {empresas.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td>{e.nome}</td><td><code>{e.slug}</code></td>
              <td>{e._count.usuarios}</td><td>{e._count.amazonAccounts}</td>
              <td>{e.ativa ? "Ativa" : "Inativa"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
