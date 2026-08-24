export type SavedFood = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  serving_grams: number;
  source: "manual" | "usda" | "barcode";
};

export type BarcodeProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

/** A blank food, ready to fill in by hand. */
export const emptyDraft = {
  name: "",
  brand: "",
  barcode: "",
  kcal_per_100g: "",
  protein_per_100g: "",
  carbs_per_100g: "",
  fat_per_100g: "",
  serving_grams: "100",
};

export type Draft = typeof emptyDraft;

export function draftFromProduct(product: BarcodeProduct): Draft {
  return {
    name: product.name,
    brand: product.brand ?? "",
    barcode: product.barcode,
    kcal_per_100g: String(Math.round(product.kcal_per_100g)),
    protein_per_100g: String(Math.round(product.protein_per_100g * 10) / 10),
    carbs_per_100g: String(Math.round(product.carbs_per_100g * 10) / 10),
    fat_per_100g: String(Math.round(product.fat_per_100g * 10) / 10),
    serving_grams: "100",
  };
}
