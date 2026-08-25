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
  // Null until chosen. Defaulting it would silently compute a stranger's
  // calorie target from the wrong resting-metabolism formula.
  sex: Sex | null;
  cuisines: string[];
  budget_level: string;
  exclusions: string[];
};

// Everything personal starts empty. These once held Shivaths' own profile,
// which was a harmless shortcut while he was the only user and a real bug the
// moment anyone else signed up: a stranger would be shown someone else's body
// stats, a pre-selected seafood allergy that was not theirs, and -- if they
// clicked straight through -- a calorie target computed from the wrong person.
//
// Goal, pace and activity keep a default because each step puts the choice in
// front of you. Height, weight, age and sex do not, because a wrong number
// there is invisible in the result.
export const initialState: OnboardingState = {
  goal: "gain",
  rate_lb_per_week: 0.5,
  gym_days: 5,
  training_type: "",
  activity_level: "moderate",
  height_cm: 0,
  weight_kg: 0,
  age: 0,
  sex: null,
  cuisines: [],
  budget_level: "medium",
  exclusions: [],
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
