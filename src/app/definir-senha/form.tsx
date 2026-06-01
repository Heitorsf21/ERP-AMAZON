"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DefinirSenhaForm({ token, empresa, email }: { token: string; empresa: string; email: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 8) return setErro("Mínimo 8 caracteres.");
    if (senha !== confirma) return setErro("As senhas não coincidem.");
    setLoading(true);
    const res = await fetch("/api/definir-senha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, novaSenha: senha }),
    });
    setLoading(false);
    if (!res.ok) { setErro("Link inválido ou expirado. Solicite um novo convite."); return; }
    const qs = new URLSearchParams();
    if (empresa) qs.set("empresa", empresa);
    if (email) qs.set("email", email);
    router.push(`/login?${qs.toString()}`);
  }

  return (
    <form onSubmit={submit} style={{ width: 320, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2>Definir senha</h2>
      <input type="password" placeholder="Nova senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
      <input type="password" placeholder="Confirmar senha" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      <button disabled={loading} type="submit">{loading ? "Salvando..." : "Salvar e entrar"}</button>
    </form>
  );
}
