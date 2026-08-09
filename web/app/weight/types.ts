export type WeightPoint = {
  measured_on: string;
  weight_kg: number;
  ema_kg: number;
};

export type Target = {
  kcal: number;
  protein_g: number;
  source: "formula" | "adaptive";
  explanation: string;
  effective_date: string;
};

export type WeighInResult = {
  target: Target;
  adjusted: boolean;
  observed_tdee: number | null;
  observed_rate_lb_per_week: number | null;
  days_of_data: number;
};

export function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
