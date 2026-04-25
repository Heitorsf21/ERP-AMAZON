import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Clock,
  MonitorSmartphone,
  Shield,
  UserCircle,
  IdCard,
} from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { AlterarSenhaForm } from "./alterar-senha-form";
import { EncerrarSessaoButton } from "./encerrar-sessao-button";
import { DadosForm } from "./dados-form";
import { Toggle2FA } from "./toggle-2fa";
import { UploadAvatar } from "@/components/perfil/upload-avatar";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/perfil");

  const usuario = await db.usuario.findUnique({
    where: { id: session.uid },
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      avatarUrl: true,
      ultimoAcesso: true,
      createdAt: true,
      twoFactorEnabled: true,
    },
  });

  if (!usuario) redirect("/login");

  const iniciais = usuario.nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const ultimoAcesso = usuario.ultimoAcesso
    ? formatInTimeZone(
        usuario.ultimoAcesso,
        TZ,
        "dd 'de' MMMM 'às' HH:mm",
        { locale: ptBR },
      )
    : "Primeira vez por aqui";

  const membroDesde = formatInTimeZone(usuario.createdAt, TZ, "MMMM 'de' yyyy", {
    locale: ptBR,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu perfil"
        description="Identidade, segurança e sessão."
      />

      {/* Header de identidade */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
          {usuario.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/api/perfil/avatar"
              alt={usuario.nome}
              className="h-16 w-16 shrink-0 rounded-2xl border bg-white object-cover ring-2 ring-background"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-xl font-semibold text-primary-foreground shadow-sm ring-2 ring-background">
              {iniciais || <UserCircle className="h-6 w-6" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{usuario.nome}</h2>
            <p className="truncate text-sm text-muted-foreground">{usuario.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                <Shield className="h-3 w-3" />
                {usuario.role}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Último acesso: <span className="capitalize">{ultimoAcesso}</span>
              </span>
              <span className="opacity-60">·</span>
              <span>
                Membro desde <span className="capitalize">{membroDesde}</span>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">
            <IdCard className="mr-1.5 h-3.5 w-3.5" />
            Dados
          </TabsTrigger>
          <TabsTrigger value="seguranca">
            <Shield className="mr-1.5 h-3.5 w-3.5" />
            Segurança
          </TabsTrigger>
          <TabsTrigger value="sessao">
            <MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" />
            Sessão
          </TabsTrigger>
        </TabsList>

        {/* DADOS */}
        <TabsContent value="dados" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Foto de perfil</CardTitle>
                <CardDescription>
                  Aparece no menu superior e ao lado do seu nome.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadAvatar
                  iniciais={iniciais}
                  temAvatar={!!usuario.avatarUrl}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Identidade</CardTitle>
                <CardDescription>
                  Nome exibido no sistema e e-mail usado para login.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DadosForm
                  nomeInicial={usuario.nome}
                  emailInicial={usuario.email}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* SEGURANÇA */}
        <TabsContent value="seguranca" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Shield className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">Senha</CardTitle>
                <CardDescription>
                  Use uma senha forte com ao menos 8 caracteres.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlterarSenhaForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Shield className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">Verificação 2FA</CardTitle>
                <CardDescription>
                  Adiciona um código por email a cada login.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Toggle2FA inicialAtivo={usuario.twoFactorEnabled} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* SESSÃO */}
        <TabsContent value="sessao" className="mt-4">
          <Card>
            <CardHeader>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MonitorSmartphone className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">Sessão atual</CardTitle>
              <CardDescription>
                Você está logado neste dispositivo desde{" "}
                <span className="capitalize text-foreground">
                  {ultimoAcesso}
                </span>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EncerrarSessaoButton />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
