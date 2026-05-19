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
  priority: number;
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
  BOOKS: "livros",
  CELLULAR_PHONE: "celulares",
  COMPUTER: "pc",
  FOOD: "comidas-bebidas",
  GROCERY: "comidas-bebidas",
  JEWELRY: "joias",
  KITCHEN: "cozinha",
  LUGGAGE: "bagagem",
  LUXURY_BEAUTY: "beleza-luxo",
  MUSIC: "musica",
  MUSICAL_INSTRUMENTS: "instrumentos-musicais",
  PET_SUPPLIES: "pet-shop",
  SHOES: "calcados-bolsas-oculos",
  SPORTS: "esportes-aventura-lazer",
  TOOLS: "ferramentas-construcao",
  TOY_FIGURE: "brinquedos-jogos",
  TOYS_AND_GAMES: "brinquedos-jogos",
  VIDEO_DVD: "video-dvd",
  WATCH: "relogios",
};

const STRONG_CONTAINS: Array<{ slug: string; terms: string[] }> = [
  { slug: "comidas-bebidas", terms: ["alimentos", "mantimentos"] },
  { slug: "bebidas-alcoolicas", terms: ["bebida alcoolica", "vinhos", "cervejas"] },
  { slug: "eletro-linha-branca", terms: ["linha branca", "lava loucas", "lava roupas"] },
  { slug: "saude-cuidados-pessoais", terms: ["saude", "higiene pessoal"] },
  { slug: "pneus-rodas", terms: ["pneus", "rodas"] },
  { slug: "industria-ciencia", terms: ["industria", "cientifico"] },
  { slug: "bebes", terms: ["bebe", "maternidade"] },
  { slug: "pet-shop", terms: ["pet", "animais de estimacao"] },
  { slug: "eletroportateis", terms: ["eletroportatil", "cuidados pessoais eletricos"] },
  { slug: "cozinha", terms: ["utensilios de cozinha", "panelas"] },
  { slug: "jardim-piscina", terms: ["jardim", "piscina"] },
  { slug: "brinquedos-jogos", terms: ["brinquedos", "jogos"] },
  { slug: "tv-audio-cinema", terms: ["tv audio", "home theater", "televisores"] },
  { slug: "celulares", terms: ["celulares", "smartphones"] },
  { slug: "camera-fotografia", terms: ["fotografia", "camera"] },
  { slug: "videogames-consoles", terms: ["videogames", "consoles"] },
  { slug: "eletronicos-portateis", terms: ["eletronicos portateis"] },
  { slug: "automotivos", terms: ["automotivo", "automotivos"] },
  { slug: "beleza-luxo", terms: ["beleza de luxo"] },
  { slug: "beleza", terms: ["beleza"] },
  { slug: "esportes-aventura-lazer", terms: ["esportes", "aventura", "lazer"] },
  { slug: "ferramentas-construcao", terms: ["ferramentas", "construcao"] },
  { slug: "papelaria-escritorio", terms: ["papelaria", "escritorio"] },
  { slug: "bagagem", terms: ["bagagem", "malas"] },
  { slug: "roupas-acessorios", terms: ["roupas", "vestuario"] },
  { slug: "calcados-bolsas-oculos", terms: ["calcados", "bolsas", "oculos"] },
  { slug: "relogios", terms: ["relogios"] },
  { slug: "joias", terms: ["joias"] },
  { slug: "livros", terms: ["livros"] },
  { slug: "acessorios-eletronicos-pc", terms: ["acessorios para eletronicos", "acessorios eletronicos", "acessorios para pc"] },
  { slug: "moveis", terms: ["moveis", "mobiliario"] },
  { slug: "video-dvd", terms: ["video e dvd", "dvd"] },
  { slug: "musica", terms: ["musica", "cds e vinil"] },
  { slug: "instrumentos-musicais", terms: ["instrumentos musicais"] },
];

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

function resolveTextSlug(text: string, source: Source): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const exact = EXACT_BY_NORMALIZED.get(normalized);
  if (exact) return exact;

  if (source === "productType" || source === "summary") {
    const productType = PRODUCT_TYPE_SYNONYMS[normalizeProductType(text)];
    if (productType) return productType;
  }

  const hits = new Set<string>();
  for (const rule of STRONG_CONTAINS) {
    if (rule.terms.some((term) => normalized.includes(normalizeText(term)))) {
      hits.add(rule.slug);
    }
  }

  return hits.size === 1 ? [...hits][0] ?? null : null;
}

function pushCandidate(
  candidates: Candidate[],
  text: string | null | undefined,
  source: Source,
  priority: number,
) {
  const trimmed = text?.trim();
  if (!trimmed) return;
  if (candidates.some((c) => normalizeText(c.text) === normalizeText(trimmed))) return;
  candidates.push({ text: trimmed, source, priority });
}

function pushClassificationChain(
  candidates: Candidate[],
  classification: SPCatalogClassification | undefined,
) {
  let current = classification;
  let depth = 0;
  while (current && depth < 5) {
    pushCandidate(candidates, current.displayName, "classification", depth);
    current = current.parent;
    depth += 1;
  }
}

function collectCandidates(item: SPCatalogItem): Candidate[] {
  const candidates: Candidate[] = [];

  for (const group of item.classifications ?? []) {
    for (const classification of group.classifications ?? []) {
      pushClassificationChain(candidates, classification);
    }
  }

  for (const summary of item.summaries ?? []) {
    pushCandidate(candidates, summary.productType, "summary", 10);
  }

  for (const productType of item.productTypes ?? []) {
    pushCandidate(candidates, productType.productType, "productType", 20);
  }

  return candidates;
}

export function inferAmazonCategoriaFee(
  item: SPCatalogItem,
): AmazonFeeCategoryInference | null {
  const candidates = collectCandidates(item);
  const priorities = [...new Set(candidates.map((candidate) => candidate.priority))].sort(
    (a, b) => a - b,
  );

  for (const priority of priorities) {
    const matches = candidates
      .filter((candidate) => candidate.priority === priority)
      .map((candidate) => ({
        candidate,
        slug: resolveTextSlug(candidate.text, candidate.source),
      }))
      .filter((match): match is { candidate: Candidate; slug: string } => !!match.slug);

    const uniqueSlugs = [...new Set(matches.map((match) => match.slug))];
    if (uniqueSlugs.length > 1) return null;
    const match = matches[0];
    if (!match) continue;
    const rule = findCommissionRule(match.slug);
    if (!rule) continue;
    return {
      slug: match.slug,
      label: rule.label,
      matchedText: match.candidate.text,
      source: match.candidate.source,
    };
  }

  return null;
}

export const __test_utils__ = {
  normalizeText,
  resolveTextSlug,
  collectCandidates,
};
