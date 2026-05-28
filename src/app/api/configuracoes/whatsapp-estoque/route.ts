import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import {
  getWhatsappEstoqueConfigPublic,
  saveWhatsappEstoqueConfig,
} from "@/modules/whatsapp-estoque/config";
import { obterUltimoEnvio } from "@/modules/whatsapp-estoque/jobs";
import { salvarConfigSchema } from "@/modules/whatsapp-estoque/schemas";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  const [config, ultimoEnvio] = await Promise.all([
    getWhatsappEstoqueConfigPublic(),
    obterUltimoEnvio(),
  ]);
  return ok({ config, ultimoEnvio });
});

export const POST = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  const input = salvarConfigSchema.parse(await req.json());
  await saveWhatsappEstoqueConfig(input);
  const [config, ultimoEnvio] = await Promise.all([
    getWhatsappEstoqueConfigPublic(),
    obterUltimoEnvio(),
  ]);
  return ok({ config, ultimoEnvio });
});
