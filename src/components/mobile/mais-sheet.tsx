"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Bell,
  ChevronRight,
  Download,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  SlidersHorizontal,
  Sun,
  UserCircle,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { HOME_ITEM } from "@/components/nav-routes";
import { useMenuVisivel } from "@/components/menu/use-menu-visivel";
import { usePwa } from "@/components/pwa/pwa-provider";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";
import { DialogAvisosAoSair, useLogout } from "@/components/auth/use-logout";

// Já estão na barra inferior ou na seção "Conta e app".
const FORA_DA_LISTA = new Set([
  "/dashboard-ecommerce",
  "/vendas",
  "/produtos",
  "/configuracoes",
  "/perfil",
]);

type Icone = React.ComponentType<{ className?: string }>;

function Linha({
  icone: Icone,
  rotulo,
  sub,
  tom = "normal",
}: {
  icone: Icone;
  rotulo: string;
  sub?: string;
  tom?: "normal" | "destaque" | "perigo";
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tom === "destaque" && "bg-primary/10 text-primary",
          tom === "perigo" && "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
          tom === "normal" && "bg-muted text-foreground/80",
        )}
      >
        <Icone className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{rotulo}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </>
  );
}

const CLASSE_LINHA =
  "flex min-h-[52px] w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left active:bg-muted";

const TEMAS = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
] as const;

// Abaixo de lg a sidebar (dona do ThemeToggle) some: o tema precisa morar aqui.
function LinhaTema() {
  const { theme, setTheme } = useTheme();
  const [montado, setMontado] = React.useState(false);
  React.useEffect(() => setMontado(true), []);

  return (
    <div className="flex flex-col gap-2 rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
          <Palette className="h-[18px] w-[18px]" />
        </span>
        <span id="mais-tema-rotulo" className="text-[15px] font-medium">
          Tema
        </span>
      </div>
      <div
        role="group"
        aria-labelledby="mais-tema-rotulo"
        className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
      >
        {TEMAS.map(({ value, label, icon: Icon }) => {
          const ativo = montado && theme === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={ativo}
              onClick={() => setTheme(value)}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors",
                ativo
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground active:bg-background/60",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ROTULO_SECAO =
  "px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function MaisSheet({
  aberto,
  onAbertoChange,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const { grupos, homeVisivel } = useMenuVisivel();
  const { plataforma } = usePwa();
  const logout = useLogout({ perguntarAvisos: true });
  const [instalarAberto, setInstalarAberto] = React.useState(false);

  const extras = grupos
    .map((g) => ({ ...g, items: g.items.filter((i) => !FORA_DA_LISTA.has(i.href)) }))
    .filter((g) => g.items.length > 0);
  const semExtras = extras.length === 0 && !homeVisivel;
  const mostrarInstalar = !!plataforma && !plataforma.standalone;
  const fechar = () => onAbertoChange(false);

  return (
    <>
      <Sheet open={aberto} onOpenChange={onAbertoChange}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4"
        >
          <SheetTitle className="px-2 text-lg">Mais</SheetTitle>
          <SheetDescription className="sr-only">
            Outras abas do seu menu, ajustes do app e conta.
          </SheetDescription>

          {semExtras && (
            <p className="mx-2 mt-3 rounded-xl border border-dashed bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground">
              Seu menu está enxuto: só Início, Vendas e Produtos. Para trazer outras
              abas, toque em <strong className="text-primary">Personalizar menu</strong>.
            </p>
          )}

          {extras.map((g) => (
            <section key={g.id}>
              <p className={ROTULO_SECAO}>{g.label}</p>
              {g.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={fechar}
                  className={CLASSE_LINHA}
                >
                  <Linha icone={item.icon} rotulo={item.label} />
                </Link>
              ))}
            </section>
          ))}
          {homeVisivel && (
            <section>
              <p className={ROTULO_SECAO}>Outros</p>
              <Link href={HOME_ITEM.href} onClick={fechar} className={CLASSE_LINHA}>
                <Linha icone={HOME_ITEM.icon} rotulo={HOME_ITEM.label} />
              </Link>
            </section>
          )}

          <div className="mx-2 my-2 h-px bg-border" />
          <p className={ROTULO_SECAO}>Conta e app</p>
          <Link
            href={"/configuracoes?tab=menu" as Route}
            onClick={fechar}
            className={CLASSE_LINHA}
          >
            <Linha
              icone={SlidersHorizontal}
              rotulo="Personalizar menu"
              sub="Escolha o que aparece no seu menu"
              tom="destaque"
            />
          </Link>
          <Link
            href={"/configuracoes?tab=notificacoes" as Route}
            onClick={fechar}
            className={CLASSE_LINHA}
          >
            <Linha icone={Bell} rotulo="Notificações deste celular" sub="Aviso a cada venda" />
          </Link>
          {mostrarInstalar && (
            <button
              type="button"
              className={CLASSE_LINHA}
              onClick={() => {
                fechar();
                setInstalarAberto(true);
              }}
            >
              <Linha
                icone={Download}
                rotulo="Instalar app"
                sub="Abrir como app na tela inicial"
              />
            </button>
          )}
          <LinhaTema />
          <Link href={"/configuracoes" as Route} onClick={fechar} className={CLASSE_LINHA}>
            <Linha icone={Settings} rotulo="Configurações" />
          </Link>
          <Link href={"/perfil" as Route} onClick={fechar} className={CLASSE_LINHA}>
            <Linha icone={UserCircle} rotulo="Meu perfil" />
          </Link>
          <button
            type="button"
            className={cn(CLASSE_LINHA, "text-red-700 dark:text-red-300")}
            disabled={logout.saindo}
            onClick={() => {
              fechar();
              void logout.sair();
            }}
          >
            <Linha icone={LogOut} rotulo="Sair" tom="perigo" />
          </button>
        </SheetContent>
      </Sheet>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
      <DialogAvisosAoSair controle={logout} />
    </>
  );
}
