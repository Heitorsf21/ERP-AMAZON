import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  HandCoins,
  Megaphone,
  Package,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Undo2,
  Wrench,
} from "lucide-react";
import { TipoNotificacao } from "@/modules/shared/domain";

// Fonte única do visual das notificações (sino do topbar + página /notificacoes).
// Labels alinhados com os das preferências (notificacoes-section.tsx).

type Severidade = "critico" | "atencao" | "positivo" | "info" | "neutro";

export type TipoNotificacaoVisual = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  severidade: Severidade;
  /** Pastilha do ícone (bg suave + cor do glifo). */
  pastilha: string;
  /** Acento na borda esquerda do card (só quando não lida). */
  acento: string;
};

// Classes completas por severidade — Tailwind só enxerga strings literais.
const SEVERIDADE_CLASSES: Record<Severidade, { pastilha: string; acento: string }> = {
  critico: {
    pastilha: "bg-red-500/10 text-red-600 dark:text-red-400",
    acento: "border-l-red-500",
  },
  atencao: {
    pastilha: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    acento: "border-l-amber-500",
  },
  positivo: {
    pastilha: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    acento: "border-l-emerald-500",
  },
  info: {
    pastilha: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    acento: "border-l-blue-500",
  },
  neutro: {
    pastilha: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    acento: "border-l-slate-400",
  },
};

type Base = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  severidade: Severidade;
};

const CONFIG: Record<TipoNotificacao, Base> = {
  ESTOQUE_CRITICO: { label: "Estoque crítico", icon: Package, severidade: "critico" },
  BUYBOX_PERDIDO: { label: "Buybox perdido", icon: TrendingDown, severidade: "atencao" },
  BUYBOX_RECUPERADO: { label: "Buybox recuperado", icon: TrendingUp, severidade: "positivo" },
  REEMBOLSO_ALTO: { label: "Reembolso alto", icon: Undo2, severidade: "atencao" },
  ACOS_ALTO: { label: "ACOS alto", icon: Megaphone, severidade: "atencao" },
  LIQUIDACAO_ATRASADA: { label: "Liquidação atrasada", icon: Clock, severidade: "atencao" },
  CUSTO_AUSENTE: { label: "Custo ausente", icon: DollarSign, severidade: "neutro" },
  JOB_FALHANDO: { label: "Job falhando", icon: AlertTriangle, severidade: "critico" },
  QUOTA_BLOQUEADA: { label: "Quota Amazon bloqueada", icon: ShieldAlert, severidade: "atencao" },
  SETTLEMENT_NOVO: { label: "Novo settlement", icon: FileText, severidade: "info" },
  RECEBIMENTO_RECONCILIADO: {
    label: "Recebimento conciliado",
    icon: CheckCircle2,
    severidade: "positivo",
  },
  WORKER_REINICIADO: { label: "Worker reiniciado", icon: RefreshCw, severidade: "neutro" },
  REIMBURSEMENT_FBA_RECEBIDO: {
    label: "FBA reimbursement recebido",
    icon: HandCoins,
    severidade: "positivo",
  },
  CONFIG_REVIEW: { label: "Revisão de configuração", icon: Wrench, severidade: "atencao" },
};

const FALLBACK: Base = { label: "Notificação", icon: Bell, severidade: "neutro" };

export function getTipoNotificacaoVisual(tipo: string): TipoNotificacaoVisual {
  const base = (CONFIG as Record<string, Base>)[tipo] ?? {
    ...FALLBACK,
    label: tipo.replace(/_/g, " ").toLowerCase(),
  };
  const classes = SEVERIDADE_CLASSES[base.severidade];
  return { ...base, ...classes };
}
