import { Badge } from "@/components/ui/badge";
import type { StatusReposicao } from "@/modules/shared/domain";

export function BadgeReposicao({ status }: { status: StatusReposicao }) {
  if (status === "REPOR")
    return <Badge variant="destructive">Repor</Badge>;
  if (status === "ATENCAO")
    return <Badge variant="warning">Atenção</Badge>;
  return <Badge variant="success">OK</Badge>;
}
