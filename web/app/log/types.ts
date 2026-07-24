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
  /** usda = real database numbers, llm = the model's estimate, user = added by hand. */
  source: "usda" | "llm" | "user";
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

export type AnalyzeResult = {
  meal_summary: string;
  input_mode: string;
  items: ResolvedItem[];
  questions: Question[];
  totals: Totals;
  warnings: string[];
  analysis_json: Record<string, unknown>;
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
