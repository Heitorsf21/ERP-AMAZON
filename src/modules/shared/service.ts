import { db } from "@/lib/db";
import { TipoCategoria } from "./domain";
import { filtrosCategoriaSchema, novaCategoriaSchema } from "./schemas";

// Categorias "AMBAS" aparecem em qualquer listagem (receita ou despesa).
function filtroPorTipo(tipo?: string) {
  if (!tipo) return {};
  if (tipo === TipoCategoria.AMBAS) return {};
  return { tipo: { in: [tipo, TipoCategoria.AMBAS] } };
}

export const categoriaService = {
  async listar(filtros: unknown = {}) {
    const parsed = filtrosCategoriaSchema.parse(filtros);
    return db.categoria.findMany({
      where: filtroPorTipo(parsed.tipo),
      orderBy: { nome: "asc" },
    });
  },

  async criar(input: unknown) {
    const data = novaCategoriaSchema.parse(input);
    return db.categoria.create({ data });
  },
};
