"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlataformaLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErro(null); setLoading(true);
    const res = await fetch("/api/plataforma/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    setLoading(false);
    if (!res.ok) { setErro("Credenciais inválidas."); return; }
    router.push("/plataforma");
  }

  return (
    <form onSubmit={submit} style={{ width: 320, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2>Plataforma · Atlas Seller</h2>
      <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      <button disabled={loading} type="submit">{loading ? "Entrando..." : "Entrar"}</button>
    </form>
  );
}
