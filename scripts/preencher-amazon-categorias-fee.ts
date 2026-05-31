import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { db } from "@/lib/db";
import { findCommissionRule, formatCommissionRule } from "@/modules/produtos/commission-table";

type CategoriaEsperada = {
  sku: string;
  amazonCategoria: string;
  amazonCategoriaFee: string;
  permitirPreencherAmazonCategoria?: boolean;
};

const CATEGORIAS_ESPERADAS: CategoriaEsperada[] = [
  { sku: "MFS-0012", amazonCategoria: "Mixers", amazonCategoriaFee: "cozinha" },
  { sku: "MFS-0037", amazonCategoria: "Mixers", amazonCategoriaFee: "cozinha" },
  { sku: "MFS-0038", amazonCategoria: "Mixers", amazonCategoriaFee: "cozinha" },
  {
    sku: "MFS-0017",
    amazonCategoria: "Travesseiros Especiais",
    amazonCategoriaFee: "saude-cuidados-pessoais",
  },
  {
    sku: "MFS-0023+A",
    amazonCategoria: "Bolsas Organizadoras de Cabo",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0023+C",
    amazonCategoria: "Bolsas Organizadoras de Cabo",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0023+P",
    amazonCategoria: "Bolsas Organizadoras de Cabo",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0023+R",
    amazonCategoria: "Bolsas Organizadoras de Cabo",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0025",
    amazonCategoria: "Adaptadores de Tomadas Internacionais",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0025+2",
    amazonCategoria: "Adaptadores de Tomadas Internacionais",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
  },
  {
    sku: "MFS-0029",
    amazonCategoria: "Adaptadores de Tomadas Internacionais",
    amazonCategoriaFee: "acessorios-eletronicos-pc",
    permitirPreencherAmazonCategoria: true,
  },
  {
    sku: "MFS-0027",
    amazonCategoria: "Conteineres de Armazenamento de Alimentos",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0034",
    amazonCategoria: "Conteineres de Armazenamento de Alimentos",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0032",
    amazonCategoria: "Potes e Porta-Mantimentos",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0036",
    amazonCategoria: "Potes e Porta-Mantimentos",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0033",
    amazonCategoria: "Potes e Tigelas de Servir",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0035",
    amazonCategoria: "Recipientes para Misturar",
    amazonCategoriaFee: "cozinha",
  },
  {
    sku: "MFS-0030",
    amazonCategoria: "Interfones",
    amazonCategoriaFee: "ferramentas-construcao",
  },
  {
    sku: "MFS-0031",
    amazonCategoria: "Mascaras para Dormir",
    amazonCategoriaFee: "saude-cuidados-pessoais",
  },
];

function parseArgs() {
  const apply = process.argv.includes("--apply");
  return { apply };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function assertCommissionSlugs() {
  for (const item of CATEGORIAS_ESPERADAS) {
    if (!findCommissionRule(item.amazonCategoriaFee)) {
      throw new Error(`Categoria fee invalida no script: ${item.amazonCategoriaFee}`);
    }
  }
}

async function main() {
  const { apply } = parseArgs();
  assertCommissionSlugs();

  const skus = CATEGORIAS_ESPERADAS.map((item) => item.sku);
  const produtos = await db.produto.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      ativo: true,
      amazonCategoria: true,
      amazonCategoriaFee: true,
    },
  });
  const produtoBySku = new Map(produtos.map((produto) => [produto.sku, produto]));

  const planned: Array<{
    sku: string;
    amazonCategoria?: string;
    amazonCategoriaFee: string;
    regra: string;
  }> = [];
  const unchanged: string[] = [];
  const skipped: Array<{ sku: string; motivo: string }> = [];

  for (const expected of CATEGORIAS_ESPERADAS) {
    const produto = produtoBySku.get(expected.sku);
    const rule = findCommissionRule(expected.amazonCategoriaFee);
    if (!rule) continue;

    if (!produto) {
      skipped.push({ sku: expected.sku, motivo: "produto nao encontrado" });
      continue;
    }
    if (!produto.ativo) {
      skipped.push({ sku: expected.sku, motivo: "produto inativo" });
      continue;
    }
    if (
      produto.amazonCategoria &&
      normalizeText(produto.amazonCategoria) !== normalizeText(expected.amazonCategoria)
    ) {
      skipped.push({
        sku: expected.sku,
        motivo: `amazonCategoria divergente: "${produto.amazonCategoria}"`,
      });
      continue;
    }
    if (!produto.amazonCategoria && !expected.permitirPreencherAmazonCategoria) {
      skipped.push({ sku: expected.sku, motivo: "amazonCategoria ausente" });
      continue;
    }
    if (produto.amazonCategoriaFee) {
      if (produto.amazonCategoriaFee === expected.amazonCategoriaFee) {
        unchanged.push(expected.sku);
      } else {
        skipped.push({
          sku: expected.sku,
          motivo: `amazonCategoriaFee manual existente: "${produto.amazonCategoriaFee}"`,
        });
      }
      continue;
    }

    planned.push({
      sku: expected.sku,
      amazonCategoria: produto.amazonCategoria ? undefined : expected.amazonCategoria,
      amazonCategoriaFee: expected.amazonCategoriaFee,
      regra: formatCommissionRule(rule),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        expected: CATEGORIAS_ESPERADAS.length,
        planned: planned.length,
        unchanged: unchanged.length,
        skipped: skipped.length,
        plannedUpdates: planned,
        unchangedSkus: unchanged,
        skippedItems: skipped,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    await db.$disconnect();
    return;
  }

  for (const item of planned) {
    await db.produto.updateMany({
      where: { sku: item.sku },
      data: {
        amazonCategoriaFee: item.amazonCategoriaFee,
        ...(item.amazonCategoria ? { amazonCategoria: item.amazonCategoria } : {}),
      },
    });
  }

  console.log(`Aplicados ${planned.length} update(s).`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
