export type Macros = {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

export type ResolvedItem = Macros & {
  name: string;
  usda_query: string;
  grams: number;
  count: number;
  unit: string;
  confidence: number;
  /** Where the numbers came from, best first: barcode = printed on the packet,
   *  usda = real database numbers, user = your own saved food, llm = estimated. */
  source: "usda" | "llm" | "user" | "barcode";
  usda_fdc_id: number | null;
  usda_description: string | null;
};

export type QuestionOption = { index: number; label: string };

export type Question = {
  id: string;
  question: string;
  reason: "hidden_fat" | "portion";
  affects_items: string[];
  options: QuestionOption[];
  kcal_impact: string;
};

export type Totals = Record<"kcal" | "protein_g" | "carbs_g" | "fat_g", number>;

/** A meal logged before that looks like this one. Offered, never auto-applied. */
export type SimilarMeal = {
  meal_id: string;
  summary: string;
  similarity: number;
  logged_on: string | null;
  totals: Totals;
  items: ResolvedItem[];
};

export type AnalyzeResult = {
  meal_summary: string;
  input_mode: string;
  items: ResolvedItem[];
  questions: Question[];
  totals: Totals;
  warnings: string[];
  analysis_json: Record<string, unknown>;
  similar_meal: SimilarMeal | null;
};

export type UsdaCandidate = {
  fdc_id: number;
  description: string;
  data_type: string;
  kcal_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
};

/** `fat_name` is null when the photo contained no cooking fat at all. */
export type FatAnswer = { fat_name: string | null; grams: number | null; confidence: number };

/** Anything below this is shown as "worth a look" rather than stated as fact. */
export const LOW_CONFIDENCE = 0.7;

export function round(value: number | null): number {
  return Math.round(value ?? 0);
}

/** Re-weigh an item. Macros are linear in grams, so scaling what we already
 *  have is exact and saves a round trip -- the server re-sums the meal from
 *  these parts anyway, so the stored total always matches what was submitted.
 *
 *  Lives here because three screens re-weigh items: the scanned-packet list,
 *  the review step, and editing a meal in history. */
export function scaleItem(item: ResolvedItem, grams: number): ResolvedItem {
  const factor = item.grams > 0 ? grams / item.grams : 0;
  const scale = (value: number | null) => (value === null ? null : value * factor);
  return {
    ...item,
    grams,
    kcal: scale(item.kcal),
    protein_g: scale(item.protein_g),
    carbs_g: scale(item.carbs_g),
    fat_g: scale(item.fat_g),
  };
}

/** Sum a meal's items. The server re-sums these on /log, so this only keeps the
 *  screen honest while you are still editing. */
export function sumTotals(items: ResolvedItem[]): Totals {
  return {
    kcal: items.reduce((sum, i) => sum + (i.kcal ?? 0), 0),
    protein_g: items.reduce((sum, i) => sum + (i.protein_g ?? 0), 0),
    carbs_g: items.reduce((sum, i) => sum + (i.carbs_g ?? 0), 0),
    fat_g: items.reduce((sum, i) => sum + (i.fat_g ?? 0), 0),
  };
}
