"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NovaEmpresaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErro(null); setMsg(null); setLoading(true);
    const res = await fetch("/api/plataforma/empresas", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, slug, admin: { nome: adminNome, email: adminEmail } }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(data.erro === "SLUG_OU_EMAIL_DUPLICADO" ? "Slug já existe." : data.detalhe || "Erro ao criar."); return; }
    if (data.conviteViaConsole) {
      setMsg("Empresa criada. Convite logado no console (SMTP não configurado).");
    } else if (data.conviteEmailOk === false) {
      setMsg("Empresa criada, mas o e-mail de convite falhou. Use 'reenviar convite'.");
    } else {
      setMsg("Empresa criada. Convite enviado por e-mail.");
    }
    setTimeout(() => router.push("/plataforma"), 1500);
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      <input placeholder="Nome da empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input placeholder="Slug (ex: lojax)" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
      <input placeholder="Nome do admin" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
      <input type="email" placeholder="E-mail do admin" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      {msg && <p style={{ color: "#16a34a", fontSize: 13 }}>{msg}</p>}
      <button disabled={loading} type="submit">{loading ? "Criando..." : "Criar empresa + convidar admin"}</button>
    </form>
  );
}
