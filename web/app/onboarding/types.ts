export type Goal = "lose" | "gain" | "recomp";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Sex = "male" | "female";

export type OnboardingState = {
  goal: Goal;
  rate_lb_per_week: number;
  gym_days: number;
  training_type: string;
  activity_level: ActivityLevel;
  height_cm: number;
  weight_kg: number;
  age: number;
  sex: Sex;
  cuisines: string[];
  budget_level: string;
  exclusions: string[];
};

// Defaults match Shivaths' own seed profile from docs/vision-prompt.md
// (5'10.5" / 148lb converts to exactly 179cm / 67kg).
export const initialState: OnboardingState = {
  goal: "gain",
  rate_lb_per_week: 0.5,
  gym_days: 5,
  training_type: "",
  activity_level: "moderate",
  height_cm: 179,
  weight_kg: 67,
  age: 20,
  sex: "male",
  cuisines: ["South Indian"],
  budget_level: "medium",
  exclusions: ["Seafood"],
};

export const RATE_OPTIONS: Record<Goal, number[]> = {
  lose: [0.5, 1.0, 1.5],
  gain: [0.25, 0.5],
  recomp: [0],
};

export const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; desc: string }[] = [
  { value: "sedentary", label: "Sedentary", desc: "Desk job, little walking" },
  { value: "light", label: "Light", desc: "Some walking, light chores" },
  { value: "moderate", label: "Moderate", desc: "On your feet a lot, casual sports" },
  { value: "active", label: "Active", desc: "Physical job or daily exercise" },
  { value: "very_active", label: "Very active", desc: "Physical job + hard training" },
];

export const CUISINE_OPTIONS = [
  "South Indian", "North Indian", "Mexican", "Italian", "Chinese", "Thai",
  "Japanese", "Korean", "Mediterranean", "Middle Eastern", "Ethiopian",
  "Vietnamese", "Caribbean", "Southern / soul food", "Greek",
];

export const EXCLUSION_OPTIONS = [
  "Seafood", "Shellfish", "Dairy", "Eggs", "Peanuts", "Tree nuts",
  "Gluten", "Soy", "Pork", "Beef", "Sesame", "Alcohol",
];
