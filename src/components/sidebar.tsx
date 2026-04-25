"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import * as React from "react";
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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  ShoppingBag,
  Settings,
  Star,
  UserCircle,
  Banknote,
  Store,
  Cog,
  Menu,
  Bell,
  Megaphone,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type LeafItem = {
  href: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  badge?: number;
};

type Group = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: LeafItem[];
};

const homeItem: LeafItem = { href: "/home" as Route, label: "Home", icon: Home };

const groups: Group[] = [
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Banknote,
    items: [
      { href: "/financeiro/dashboard" as Route, label: "Dashboard", icon: LayoutDashboard },
      { href: "/caixa" as Route, label: "Caixa", icon: Wallet },
      { href: "/contas-a-pagar" as Route, label: "Contas a Pagar", icon: FileText },
      { href: "/contas-a-receber" as Route, label: "Contas a Receber", icon: ArrowDownToLine },
      { href: "/destinacao" as Route, label: "Destinação", icon: PiggyBank },
      { href: "/dre" as Route, label: "DRE", icon: BarChart3 },
    ],
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    icon: Store,
    items: [
      { href: "/dashboard-ecommerce" as Route, label: "Dashboard", icon: BarChart3 },
      { href: "/estoque" as Route, label: "Estoque", icon: Package },
      { href: "/vendas" as Route, label: "Vendas", icon: ShoppingBag },
      { href: "/compras" as Route, label: "Compras", icon: ShoppingCart },
      { href: "/avaliacoes" as Route, label: "Avaliações", icon: Star },
      { href: "/publicidade" as Route, label: "Publicidade", icon: Megaphone },
    ],
  },
  {
    id: "configuracao",
    label: "Configuração",
    icon: Cog,
    items: [
      { href: "/amazon" as Route, label: "Conector Amazon", icon: Globe },
      { href: "/notificacoes" as Route, label: "Notificações", icon: Bell },
      { href: "/perfil" as Route, label: "Perfil", icon: UserCircle },
      { href: "/configuracoes" as Route, label: "Configurações", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLeaf({
  item,
  active,
  collapsed,
}: {
  item: LeafItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const badgeCount = item.badge ?? 0;

  const inner = (
    <div
      className={cn(
        "group/leaf relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
        collapsed ? "justify-center px-2" : "",
        active
          ? "bg-sidebar-accent text-white shadow-sm"
          : "text-sidebar-foreground/85 hover:bg-sidebar-muted hover:text-white",
      )}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-white" />
      )}
      <span className="relative shrink-0">
        <Icon className={cn(collapsed ? "h-[18px] w-[18px]" : "h-4 w-4")} />
        {badgeCount > 0 && collapsed && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && badgeCount > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={item.href}>{inner}</Link>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return <Link href={item.href}>{inner}</Link>;
}

function NavGroup({
  group,
  expanded,
  collapsed,
  pathname,
  onToggle,
}: {
  group: Group;
  expanded: boolean;
  collapsed: boolean;
  pathname: string;
  onToggle: () => void;
}) {
  const GroupIcon = group.icon;
  const hasActive = group.items.some((it) => isActive(pathname, it.href));

  if (collapsed) {
    // Colapsado: só mostra os leaves como ícones (sem header de grupo)
    return (
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavLeaf
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            collapsed
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
          hasActive
            ? "text-sidebar-foreground/90"
            : "text-sidebar-foreground/55 hover:text-sidebar-foreground/90",
        )}
        aria-expanded={expanded}
      >
        <GroupIcon className="h-3.5 w-3.5 opacity-70" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 opacity-60 transition-transform duration-200",
            expanded ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pl-1 pt-0.5">
            {group.items.map((item) => (
              <NavLeaf
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                collapsed={false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const STORAGE_GROUPS_KEY = "sidebar-groups-expanded";

function useGroupsState() {
  const defaultState: Record<string, boolean> = React.useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, true])),
    [],
  );
  const [state, setState] = React.useState<Record<string, boolean>>(defaultState);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_GROUPS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setState({ ...defaultState, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, [defaultState]);

  function toggle(id: string) {
    setState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return { state, toggle };
}

export function SidebarContent({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { state: groupsExpanded, toggle } = useGroupsState();

  const { data: notifCount } = useQuery<{ total: number }>({
    queryKey: ["notificacoes-count"],
    queryFn: () => fetchJSON("/api/notificacoes/contar"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const groupsComBadge = React.useMemo(() => {
    const count = notifCount?.total ?? 0;
    return groups.map((g) => ({
      ...g,
      items: g.items.map((item) =>
        item.href === "/notificacoes" ? { ...item, badge: count } : item,
      ),
    }));
  }, [notifCount]);

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        "bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-[hsl(var(--sidebar-border))] px-4",
          collapsed ? "justify-center" : "gap-2.5",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--sidebar-accent))]",
            "h-8 w-8 shadow-[0_0_18px_hsl(var(--sidebar-accent)/0.35)]",
          )}
        >
          <Package className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-wide text-white">
              ERP AMAZON
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
              gestão interna
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <TooltipProvider delayDuration={100}>
        <nav className={cn("flex-1 overflow-y-auto", collapsed ? "p-2" : "p-3")}>
          {/* Home destacada */}
          <div className="mb-3">
            <NavLeaf
              item={homeItem}
              active={isActive(pathname, homeItem.href)}
              collapsed={collapsed}
            />
          </div>

          {!collapsed && (
            <div className="mb-2 h-px bg-gradient-to-r from-transparent via-[hsl(var(--sidebar-border))] to-transparent" />
          )}

          <div className={cn("space-y-3", collapsed && "space-y-2")}>
            {groupsComBadge.map((group, idx) => (
              <React.Fragment key={group.id}>
                {collapsed && idx > 0 && (
                  <div className="mx-2 h-px bg-[hsl(var(--sidebar-border))]/70" />
                )}
                <NavGroup
                  group={group}
                  expanded={groupsExpanded[group.id] ?? true}
                  collapsed={collapsed}
                  pathname={pathname}
                  onToggle={() => toggle(group.id)}
                />
              </React.Fragment>
            ))}
          </div>
        </nav>
      </TooltipProvider>

      {/* Footer */}
      <div
        className={cn(
          "flex items-center border-t border-[hsl(var(--sidebar-border))] p-2",
          collapsed ? "justify-center" : "justify-between px-3",
        )}
      >
        {!collapsed && (
          <span className="text-[11px] text-[hsl(var(--sidebar-foreground))]/50">
            v0.5.0
          </span>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) setCollapsed(saved === "true");
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  }

  return (
    <aside
      className={cn(
        "relative hidden h-screen shrink-0 flex-col transition-all duration-200 lg:flex",
        collapsed ? "w-[64px]" : "w-[240px]",
      )}
    >
      <SidebarContent collapsed={collapsed} />

      <button
        onClick={toggleCollapsed}
        className={cn(
          "absolute -right-3 top-[3.25rem] z-10 flex h-6 w-6 items-center justify-center rounded-full",
          "border border-border bg-background text-muted-foreground shadow-sm",
          "hover:bg-accent hover:text-foreground transition-colors",
        )}
        aria-label={collapsed ? "Expandir menu" : "Colapsar menu"}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </aside>
  );
}

/**
 * Sidebar mobile (sheet) — controlada por trigger externo (topbar).
 */
export function SidebarMobileSheet() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Fecha o sheet ao navegar
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] border-r-0 p-0">
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SheetDescription className="sr-only">
          Navegação principal do ERP Amazon.
        </SheetDescription>
        <SidebarContent collapsed={false} />
      </SheetContent>
    </Sheet>
  );
}
