import type { SPCatalogClassification, SPCatalogItem } from "@/lib/amazon-sp-api";
import { findCommissionRule } from "@/modules/produtos/commission-table";

type Source = "classification" | "summary" | "productType";

export type AmazonFeeCategoryInference = {
  slug: string;
  label: string;
  matchedText: string;
  source: Source;
};

type Candidate = {
  text: string;
  source: Source;
};

const EXACT_SYNONYMS: Record<string, string> = {
  "alimentos e bebidas": "comidas-bebidas",
  "comida e bebida": "comidas-bebidas",
  "comidas e bebidas": "comidas-bebidas",
  "bebidas alcoolicas": "bebidas-alcoolicas",
  "eletrodomesticos linha branca": "eletro-linha-branca",
  "linha branca": "eletro-linha-branca",
  "saude e cuidados pessoais": "saude-cuidados-pessoais",
  "cuidados pessoais": "saude-cuidados-pessoais",
  "pneus e rodas": "pneus-rodas",
  "industria e ciencia": "industria-ciencia",
  "produtos para bebes": "bebes",
  "bebes": "bebes",
  "pet shop": "pet-shop",
  "eletroportateis cuidado pessoal": "eletroportateis",
  "eletroportateis": "eletroportateis",
  "cozinha": "cozinha",
  "jardim e piscina": "jardim-piscina",
  "brinquedos e jogos": "brinquedos-jogos",
  "tv audio e cinema": "tv-audio-cinema",
  "pc": "pc",
  "computadores": "pc",
  "celulares": "celulares",
  "camera e fotografia": "camera-fotografia",
  "cameras e fotografia": "camera-fotografia",
  "videogames e consoles": "videogames-consoles",
  "eletronicos portateis": "eletronicos-portateis",
  "automotivos": "automotivos",
  "casa": "casa",
  "beleza de luxo": "beleza-luxo",
  "beleza": "beleza",
  "esportes aventura e lazer": "esportes-aventura-lazer",
  "ferramentas e construcao": "ferramentas-construcao",
  "papelaria e escritorio": "papelaria-escritorio",
  "bagagem": "bagagem",
  "roupas e acessorios": "roupas-acessorios",
  "calcados bolsas e oculos": "calcados-bolsas-oculos",
  "relogios": "relogios",
  "joias": "joias",
  "livros": "livros",
  "acessorios para eletronicos e pc": "acessorios-eletronicos-pc",
  "moveis": "moveis",
  "video e dvd": "video-dvd",
  "musica": "musica",
  "instrumentos musicais": "instrumentos-musicais",
};

const PRODUCT_TYPE_SYNONYMS: Record<string, string> = {
  BABY_PRODUCT: "bebes",
  BEAUTY: "beleza",
  BODY_POSITIONER: "saude-cuidados-pessoais",
  BOOKS: "livros",
  CELLULAR_PHONE: "celulares",
  COMPUTER: "pc",
  DISHWARE_BOWL: "cozinha",
  FOOD: "comidas-bebidas",
  FOOD_MIXER: "cozinha",
  FOOD_STORAGE_CONTAINER: "cozinha",
  GROCERY: "comidas-bebidas",
  JEWELRY: "joias",
  KITCHEN: "cozinha",
  LUGGAGE: "bagagem",
  LUXURY_BEAUTY: "beleza-luxo",
  MUSIC: "musica",
  MUSICAL_INSTRUMENTS: "instrumentos-musicais",
  PET_SUPPLIES: "pet-shop",
  POWER_CONVERTER: "acessorios-eletronicos-pc",
  POWER_STRIP: "acessorios-eletronicos-pc",
  SHOES: "calcados-bolsas-oculos",
  SLEEP_MASK: "saude-cuidados-pessoais",
  SPORTS: "esportes-aventura-lazer",
  TOOLS: "ferramentas-construcao",
  TOY_FIGURE: "brinquedos-jogos",
  TOYS_AND_GAMES: "brinquedos-jogos",
  VIDEO_DVD: "video-dvd",
  WATCH: "relogios",
};

const EXACT_BY_NORMALIZED = new Map<string, string>();
for (const [text, slug] of Object.entries(EXACT_SYNONYMS)) {
  EXACT_BY_NORMALIZED.set(normalizeText(text), slug);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeProductType(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasNode(nodes: string[], value: string): boolean {
  const normalized = normalizeText(value);
  return nodes.includes(normalized);
}

function hasNodeContaining(nodes: string[], terms: string[]): boolean {
  const normalizedTerms = terms.map(normalizeText);
  return nodes.some((node) => normalizedTerms.some((term) => node.includes(term)));
}

function pathLabel(chain: SPCatalogClassification[]): string {
  return chain
    .map((node) => node.displayName)
    .filter((name): name is string => !!name)
    .join(" > ");
}

function resolveTextSlug(text: string, source: Source): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const exact = EXACT_BY_NORMALIZED.get(normalized);
  if (exact) return exact;

  if (source === "productType" || source === "summary") {
    const productType = PRODUCT_TYPE_SYNONYMS[normalizeProductType(text)];
    if (productType) return productType;
  }

  return null;
}

function resolveClassificationChainSlug(
  chain: SPCatalogClassification[],
): string | null {
  const nodes = chain
    .map((node) => node.displayName)
    .filter((name): name is string => !!name)
    .map(normalizeText);
  if (nodes.length === 0) return null;

  if (hasNode(nodes, "cozinha")) return "cozinha";
  if (
    hasNode(nodes, "saude e bem estar") ||
    hasNode(nodes, "saude e cuidados pessoais")
  ) {
    return "saude-cuidados-pessoais";
  }
  if (
    hasNode(nodes, "ferramentas e materiais de construcao") ||
    hasNode(nodes, "ferramentas e construcao")
  ) {
    return "ferramentas-construcao";
  }
  if (hasNode(nodes, "computadores e informatica")) {
    return hasNodeContaining(nodes, ["acessorios", "cabo", "cabos"])
      ? "acessorios-eletronicos-pc"
      : "pc";
  }
  if (hasNode(nodes, "eletronicos e tecnologia")) {
    return hasNodeContaining(nodes, [
      "acessorios",
      "adaptador",
      "adaptadores",
      "alimentacao",
      "tomada",
      "tomadas",
    ])
      ? "acessorios-eletronicos-pc"
      : null;
  }

  for (const node of nodes) {
    const exact = EXACT_BY_NORMALIZED.get(node);
    if (exact) return exact;
  }

  return null;
}

function collectClassificationChains(item: SPCatalogItem): SPCatalogClassification[][] {
  const chains: SPCatalogClassification[][] = [];

  for (const group of item.classifications ?? []) {
    for (const classification of group.classifications ?? []) {
      const chain: SPCatalogClassification[] = [];
      let current: SPCatalogClassification | undefined = classification;
      let depth = 0;
      while (current && depth < 10) {
        chain.push(current);
        current = current.parent;
        depth += 1;
      }
      if (chain.length > 0) chains.push(chain);
    }
  }

  for (const summary of item.summaries ?? []) {
    if (summary.browseClassification) chains.push([summary.browseClassification]);
  }

  return chains;
}

function collectFallbackCandidates(item: SPCatalogItem): Candidate[] {
  const candidates: Candidate[] = [];

  for (const summary of item.summaries ?? []) {
    if (summary.productType) {
      candidates.push({ text: summary.productType, source: "summary" });
    }
  }
  for (const productType of item.productTypes ?? []) {
    if (productType.productType) {
      candidates.push({ text: productType.productType, source: "productType" });
    }
  }

  return candidates;
}

function buildInference(
  slug: string,
  matchedText: string,
  source: Source,
): AmazonFeeCategoryInference | null {
  const rule = findCommissionRule(slug);
  if (!rule) return null;
  return { slug, label: rule.label, matchedText, source };
}

export function inferAmazonCategoriaFee(
  item: SPCatalogItem,
): AmazonFeeCategoryInference | null {
  const chainMatches = collectClassificationChains(item)
    .map((chain) => ({
      slug: resolveClassificationChainSlug(chain),
      matchedText: pathLabel(chain),
    }))
    .filter((match): match is { slug: string; matchedText: string } => !!match.slug);
  const chainSlugs = [...new Set(chainMatches.map((match) => match.slug))];
  if (chainSlugs.length > 1) return null;
  if (chainSlugs.length === 1) {
    return buildInference(chainSlugs[0] as string, chainMatches[0]?.matchedText ?? "", "classification");
  }

  const fallbackMatches = collectFallbackCandidates(item)
    .map((candidate) => ({
      candidate,
      slug: resolveTextSlug(candidate.text, candidate.source),
    }))
    .filter((match): match is { candidate: Candidate; slug: string } => !!match.slug);
  const fallbackSlugs = [...new Set(fallbackMatches.map((match) => match.slug))];
  if (fallbackSlugs.length > 1) return null;
  if (fallbackSlugs.length === 1) {
    const match = fallbackMatches[0];
    if (!match) return null;
    return buildInference(match.slug, match.candidate.text, match.candidate.source);
  }

  return null;
}

export const __test_utils__ = {
  normalizeText,
  resolveTextSlug,
  resolveClassificationChainSlug,
  collectClassificationChains,
};
