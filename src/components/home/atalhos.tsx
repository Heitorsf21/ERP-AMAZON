// @deprecated Não usado mais na home (substituído por AlertasCriticos +
// ResumoRapidoModal em abr/2026). Mantido em disco para evitar conflitos com
// outras frentes em paralelo. Pode ser removido quando ninguém mais importar.
import Link from "next/link";
import type { Route } from "next";
import {
  FilePlus2,
  Wallet,
  Upload,
  ShoppingCart,
  Globe,
  ArrowRight,
} from "lucide-react";

type Atalho = {
  label: string;
  descricao: string;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
};

const atalhos: Atalho[] = [
  {
    label: "Nova conta a pagar",
    descricao: "Lançar um novo compromisso",
    href: "/contas-a-pagar?novo=1" as Route,
    icon: FilePlus2,
  },
  {
    label: "Nova movimentação",
    descricao: "Entrada ou saída de caixa",
    href: "/caixa?novo=1" as Route,
    icon: Wallet,
  },
  {
    label: "Importar extrato",
    descricao: "CSV ou OFX do Nubank",
    href: "/caixa?importar=1" as Route,
    icon: Upload,
  },
  {
    label: "Nova compra",
    descricao: "Pedido para fornecedor",
    href: "/compras?novo=1" as Route,
    icon: ShoppingCart,
  },
  {
    label: "Sincronizar Amazon",
    descricao: "Puxar pedidos e estoque",
    href: "/amazon" as Route,
    icon: Globe,
  },
];

export function AtalhosRapidos() {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Atalhos
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {atalhos.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.label}
              href={a.href}
              className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </div>
              <div className="mt-3">
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.descricao}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
