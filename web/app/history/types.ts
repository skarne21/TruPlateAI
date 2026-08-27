/** What GET /meals returns. Shared by the history list and its editor.
 *
 * The nullable tail exists so an edit can send an item straight back exactly
 * as it was stored -- without them, editing a portion would quietly drop the
 * USDA match and turn a checked item back into a guess.
 */
export type LoggedItem = {
  name: string;
  grams: number;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: string | null;
  usda_description: string | null;
  usda_query: string | null;
  count: number | null;
  unit: string | null;
  usda_fdc_id: number | null;
  confidence: number | null;
};

export type LoggedMeal = {
  id: string;
  logged_on: string;
  input_mode: string;
  caption: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  items: LoggedItem[];
};
