/** Self-check for portion arithmetic. Run: node app/log/types.check.ts
 *
 * This is the maths that turns "1.5 cups" into calories in someone's log, so
 * it gets a check even though it is short. Excluded from tsconfig so the .ts
 * import doesn't fail the build.
 */
import assert from "node:assert/strict";
import { gramsPerUnit, scaleItem, sumTotals, type ResolvedItem } from "./types.ts";

const milk: ResolvedItem = {
  name: "Kirkland 2 percent milk",
  usda_query: "milk 2% reduced fat",
  grams: 244,
  count: 1,
  unit: "cup",
  confidence: 0.9,
  source: "usda",
  usda_fdc_id: 1,
  usda_description: "Milk, reduced fat, 2%",
  kcal: 122,
  protein_g: 8,
  carbs_g: 12,
  fat_g: 4.8,
};

// One cup of this milk weighs 244g -- taken from the item's own analysis
// rather than a density table.
assert.equal(gramsPerUnit(milk), 244);

const double = scaleItem(milk, 488);
assert.equal(double.grams, 488);
assert.equal(double.kcal, 244, "macros scale with the portion");
// The bug this guards: grams doubled while count still said "1 cup", so the
// unit display confidently showed the wrong portion.
assert.equal(double.count, 2, "count moves with the grams");
assert.equal(gramsPerUnit(double), 244, "grams-per-unit is unchanged by rescaling");

// Half a cup, entered as 0.5 in the unit field -> 122g.
const half = scaleItem(milk, 0.5 * gramsPerUnit(milk));
assert.equal(half.grams, 122);
assert.equal(half.count, 0.5);
assert.equal(half.kcal, 61);

// An item already measured in grams has no better unit to offer, so the
// picker must not appear at all rather than offering "grams" twice.
const powder: ResolvedItem = { ...milk, name: "Whey", unit: "g", grams: 60, count: 1 };
assert.equal(gramsPerUnit(powder), 0, "grams is not an alternative to grams");
assert.equal(gramsPerUnit({ ...milk, unit: "G" }), 0, "case doesn't smuggle it back in");
assert.equal(gramsPerUnit({ ...milk, count: 0 }), 0, "no ratio without a count");
assert.equal(gramsPerUnit({ ...milk, grams: 0 }), 0, "no ratio without a weight");

// A zeroed portion must not produce NaN calories in the running total.
const zeroed = scaleItem(milk, 0);
assert.equal(zeroed.kcal, 0);
assert.equal(zeroed.count, 0);
assert.equal(sumTotals([zeroed]).kcal, 0);

// A null macro stays null rather than becoming 0 -- "unknown" and "none" are
// different claims, and the review screen says so.
const noFat = scaleItem({ ...milk, fat_g: null }, 488);
assert.equal(noFat.fat_g, null);

assert.equal(sumTotals([milk, double]).kcal, 366, "totals sum the parts");

console.log("log/types.ts: all checks passed");
