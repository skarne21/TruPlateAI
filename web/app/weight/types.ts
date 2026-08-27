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
