import { z } from "zod";
import { StatusTarefa, VisibilidadeTarefa } from "@/modules/shared/domain";

const prazoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd")
  .nullish();

export const criarTarefaSchema = z.object({
  titulo: z.string().trim().min(1, "título obrigatório").max(200),
  descricao: z.string().trim().max(2000).nullish(),
  prazo: prazoSchema,
  visibilidade: z
    .enum([VisibilidadeTarefa.EMPRESA, VisibilidadeTarefa.PESSOAL])
    .default(VisibilidadeTarefa.EMPRESA),
  // Responsável único (opcional). Para tarefa PESSOAL o servidor força o dono.
  responsavelId: z.string().trim().min(1).nullish(),
});

export const atualizarTarefaSchema = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: z.string().trim().max(2000).nullish(),
  prazo: prazoSchema,
  visibilidade: z
    .enum([VisibilidadeTarefa.EMPRESA, VisibilidadeTarefa.PESSOAL])
    .optional(),
  responsavelId: z.string().trim().min(1).nullish(),
  status: z
    .enum([
      StatusTarefa.ABERTA,
      StatusTarefa.CONCLUIDA,
      StatusTarefa.CANCELADA,
    ])
    .optional(),
});

export type CriarTarefaInput = z.infer<typeof criarTarefaSchema>;
export type AtualizarTarefaInput = z.infer<typeof atualizarTarefaSchema>;
