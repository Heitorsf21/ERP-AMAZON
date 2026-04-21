import { z } from "zod";
import { TipoCategoria } from "./domain";

export const tipoCategoriaEnum = z.enum([
  TipoCategoria.RECEITA,
  TipoCategoria.DESPESA,
  TipoCategoria.AMBAS,
]);

export const novaCategoriaSchema = z.object({
  nome: z.string().min(1).max(80),
  tipo: tipoCategoriaEnum,
  cor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "cor deve ser hex #rrggbb")
    .optional(),
});
export type NovaCategoriaInput = z.infer<typeof novaCategoriaSchema>;

export const filtrosCategoriaSchema = z.object({
  tipo: tipoCategoriaEnum.optional(),
});
export type FiltrosCategoria = z.infer<typeof filtrosCategoriaSchema>;
