import Link from "next/link";
import { Activity, Clock, GitCommit, Terminal } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SistemaSection() {
  const sha = process.env.GIT_SHA ?? "dev";
  const fuso = "America/Sao_Paulo";
  const logLevel = process.env.LOG_LEVEL ?? "info";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Sistema</CardTitle>
            <CardDescription>
              Versao, fuso e nivel de log atualmente em uso.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoRow
            icon={<GitCommit className="h-3.5 w-3.5" />}
            label="Versao"
            value={sha}
          />
          <InfoRow
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Fuso"
            value={fuso}
          />
          <InfoRow
            icon={<Terminal className="h-3.5 w-3.5" />}
            label="LOG_LEVEL"
            value={logLevel}
          />
        </div>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/sistema">Ver saude do sistema</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-xs">
        <Badge variant="outline" className="font-mono text-xs">{value}</Badge>
      </div>
    </div>
  );
}
