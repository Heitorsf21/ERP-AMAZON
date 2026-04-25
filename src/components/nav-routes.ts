// Single source of truth para todas as rotas do menu.
// Consumido pelo Sidebar (navegação) e pelo CommandPalette (busca de páginas).
import {
  LayoutDashboard,
  Wallet,
  FileText,
  ArrowDownToLine,
  Package,
  ShoppingCart,
  PiggyBank,
  Globe,
  BarChart3,
  Home,
  ShoppingBag,
  Settings,
  Star,
  UserCircle,
  Banknote,
  Store,
  Cog,
  Bell,
  Megaphone,
  Activity,
} from "lucide-react";
import type { Route } from "next";

export type NavLeaf = {
  href: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  /** Termos extras de busca (sinônimos, conceitos relacionados). */
  keywords?: string[];
};

export type NavGroup = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavLeaf[];
};

export const HOME_ITEM: NavLeaf = {
  href: "/home" as Route,
  label: "Home",
  icon: Home,
  keywords: ["inicio", "principal", "central"],
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Banknote,
    items: [
      {
        href: "/financeiro/dashboard" as Route,
        label: "Dashboard Financeiro",
        icon: LayoutDashboard,
        keywords: ["relatorio", "resumo", "financeiro", "grafico"],
      },
      {
        href: "/caixa" as Route,
        label: "Caixa",
        icon: Wallet,
        keywords: ["extrato", "movimentacao", "bancario", "lancamento", "banco"],
      },
      {
        href: "/contas-a-pagar" as Route,
        label: "Contas a Pagar",
        icon: FileText,
        keywords: ["debito", "fornecedor", "boleto", "pagar", "vencimento"],
      },
      {
        href: "/contas-a-receber" as Route,
        label: "Contas a Receber",
        icon: ArrowDownToLine,
        keywords: ["amazon", "recebimento", "liquidacao", "receber"],
      },
      {
        href: "/notas-fiscais" as Route,
        label: "Notas Fiscais",
        icon: FileText,
        keywords: ["nf", "boleto", "documento", "fiscal"],
      },
      {
        href: "/destinacao" as Route,
        label: "Destinação de Caixa",
        icon: PiggyBank,
        keywords: ["saldo", "livre", "comprometido", "projetado", "bolsa"],
      },
      {
        href: "/dre" as Route,
        label: "DRE",
        icon: BarChart3,
        keywords: ["resultado", "lucro", "prejuizo", "demonstrativo", "receita", "despesa"],
      },
    ],
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    icon: Store,
    items: [
      {
        href: "/dashboard-ecommerce" as Route,
        label: "Dashboard E-commerce",
        icon: BarChart3,
        keywords: ["amazon", "vendas", "metricas", "kpi"],
      },
      {
        href: "/produtos" as Route,
        label: "Produtos",
        icon: Package,
        keywords: ["estoque", "inventario", "fba", "quantidade", "sku", "catalogo"],
      },
      {
        href: "/vendas" as Route,
        label: "Vendas",
        icon: ShoppingBag,
        keywords: ["pedidos", "venda", "orders"],
      },
      {
        href: "/compras" as Route,
        label: "Compras",
        icon: ShoppingCart,
        keywords: ["pedido compra", "reposicao", "fornecedor", "purchase"],
      },
      {
        href: "/avaliacoes" as Route,
        label: "Avaliações",
        icon: Star,
        keywords: ["reviews", "solicitacao", "estrelas", "feedback"],
      },
      {
        href: "/publicidade" as Route,
        label: "Publicidade",
        icon: Megaphone,
        keywords: ["ads", "anuncios", "ppc", "acos", "tacos"],
      },
    ],
  },
  {
    id: "configuracao",
    label: "Configuração",
    icon: Cog,
    items: [
      {
        href: "/amazon" as Route,
        label: "Conector Amazon",
        icon: Globe,
        keywords: ["sp-api", "sincronizar", "api", "credenciais", "marketplace"],
      },
      {
        href: "/notificacoes" as Route,
        label: "Notificações",
        icon: Bell,
        keywords: ["alertas", "sino", "avisos"],
      },
      {
        href: "/sistema" as Route,
        label: "Saúde do Sistema",
        icon: Activity,
        keywords: ["worker", "fila", "jobs", "quotas", "heartbeat", "health"],
      },
      {
        href: "/perfil" as Route,
        label: "Meu Perfil",
        icon: UserCircle,
        keywords: ["senha", "usuario", "conta", "alterar"],
      },
      {
        href: "/configuracoes" as Route,
        label: "Configurações",
        icon: Settings,
        keywords: ["sistema", "preferencias", "config"],
      },
    ],
  },
];

/** Lista plana de todas as rotas (Home + items dos grupos). Útil pro command-palette. */
export const ALL_NAV_ITEMS: Array<NavLeaf & { group: string }> = [
  { ...HOME_ITEM, group: "Páginas" },
  ...NAV_GROUPS.flatMap((g) =>
    g.items.map((item) => ({
      ...item,
      group: g.label,
    })),
  ),
];
