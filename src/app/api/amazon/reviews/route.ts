import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { listReviewSolicitations } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.OPERADOR], async () => {
  const solicitations = await listReviewSolicitations();
  return ok(solicitations);
});
