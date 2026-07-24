// Height/weight are always stored canonically in cm/kg (what api/targets.py
// expects) -- these helpers only convert what's *displayed*.

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round((totalIn - ft * 12) * 2) / 2;
  return { ft, inch };
}

export function ftInToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * 2.54;
}

export function kgToLb(kg: number): number {
  return kg / 0.453592;
}

export function lbToKg(lb: number): number {
  return lb * 0.453592;
}
