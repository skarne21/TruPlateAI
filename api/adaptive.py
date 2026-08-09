"""Adaptive TDEE: learn the user's real energy expenditure from their own data.

Mifflin-St Jeor is a population average. After a fortnight the user has better
evidence about their own body -- what they ate, and what their weight did --
and energy balance turns those two facts into their actual expenditure.

Entirely deterministic (CLAUDE.md invariant #10). No LLM is involved anywhere
in this file, and none should be: this is the part that has to be provably
right.
"""

from dataclasses import dataclass
from datetime import date

# Weight given to the newest weigh-in. High enough to track a real trend inside
# a week, low enough that one salty dinner doesn't read as fat gain.
ALPHA = 0.3

# Standard approximation for the energy in a pound of body mass.
KCAL_PER_LB_BODY = 3500.0

# 500 kcal/day for a pound a week -- the same constant targets.py uses. The
# adaptive path must not disagree with the formula path about basic arithmetic.
KCAL_PER_LB_PER_WEEK = 500.0

KG_PER_LB = 0.453592

# Below this, weight noise swamps the signal and no adjustment is made at all.
MIN_DAYS = 14

# Fully trusting observed TDEE at four weeks; ramps in from MIN_DAYS.
FULL_TRUST_DAYS = 28

# Most a single adjustment may move the target. One anomalous week -- illness,
# a holiday -- would otherwise swing it hundreds of calories, and a number
# people plan meals around has to be stable to be trusted.
MAX_CHANGE_KCAL = 150.0

# Fraction of days needing a logged meal before intake is believable.
ADHERENCE_THRESHOLD = 0.7


@dataclass
class WeighIn:
    measured_on: date
    weight_kg: float


@dataclass
class DayIntake:
    day: date
    kcal: float


@dataclass
class Recommendation:
    adjusted: bool
    new_kcal: float
    explanation: str
    days_of_data: int
    observed_rate_lb_per_week: float | None = None
    observed_tdee: float | None = None


def ema_series(weights: list[float], alpha: float = ALPHA) -> list[float]:
    """Exponential moving average over weigh-ins.

    Daily weight swings pounds on water and gut contents, so a trend read off
    raw readings is mostly noise. Each point blends the newest reading with the
    running average: ema[t] = alpha*w[t] + (1-alpha)*ema[t-1].
    """
    if not weights:
        return []
    smoothed = [weights[0]]
    for value in weights[1:]:
        smoothed.append(alpha * value + (1 - alpha) * smoothed[-1])
    return smoothed


def observed_tdee(mean_intake: float, delta_lb: float, days: int) -> float:
    """Energy expenditure implied by what they ate and what their weight did.

    Gaining weight on a given intake means expenditure was *below* it; losing
    means it was above. The sign here is the whole point, and getting it
    backwards would push calories the wrong way.
    """
    if days <= 0:
        return mean_intake
    return mean_intake - (delta_lb * KCAL_PER_LB_BODY / days)


def blend_tdee(formula: float, observed: float, days: int) -> float:
    """Ramp from the formula estimate to the observed one over weeks 2-4.

    Two weeks of data is suggestive, not conclusive -- one poorly logged week
    would swing it. Trust builds with evidence instead of switching over at a
    threshold.
    """
    span = FULL_TRUST_DAYS - MIN_DAYS
    trust = (days - MIN_DAYS) / span
    trust = min(1.0, max(0.0, trust))
    return (1 - trust) * formula + trust * observed


def recommend_target(
    current_kcal: float,
    target_rate_lb_per_week: float,
    formula_tdee: float,
    weights: list[WeighIn],
    intakes: list[DayIntake],
) -> Recommendation:
    """Decide whether the calorie target should move, and by how much."""
    ordered = sorted(weights, key=lambda w: w.measured_on)
    days_span = (ordered[-1].measured_on - ordered[0].measured_on).days + 1 if ordered else 0

    if len(ordered) < 2 or days_span < MIN_DAYS:
        return Recommendation(
            adjusted=False,
            new_kcal=current_kcal,
            days_of_data=days_span,
            explanation=(
                "Keep logging — targets start adapting to your own data after "
                f"14 days of weigh-ins. ({days_span} so far.)"
            ),
        )

    logged_days = len({i.day for i in intakes})
    if logged_days < ADHERENCE_THRESHOLD * days_span:
        # Intake is only known for logged days. With too many missing, mean
        # intake reads low, observed TDEE comes out low, and the engine would
        # cut calories from someone who simply forgot to log. Fail closed.
        return Recommendation(
            adjusted=False,
            new_kcal=current_kcal,
            days_of_data=days_span,
            explanation=(
                f"You logged {logged_days} of the last {days_span} days. "
                "Targets only adapt once most days are logged, so a few missed "
                "days can't look like eating less."
            ),
        )

    smoothed = ema_series([w.weight_kg for w in ordered])
    # ponytail: EMA lags a steady trend by roughly (1-alpha)/alpha readings, so
    # this understates a real change slightly (~20 kcal over four weeks). Small
    # against day-to-day weight noise, and the cap limits any damage. Fit a
    # regression over the smoothed series if that ever proves too coarse.
    delta_lb = (smoothed[-1] - smoothed[0]) / KG_PER_LB
    observed_rate = delta_lb / days_span * 7

    mean_intake = sum(i.kcal for i in intakes) / len(intakes)
    observed = observed_tdee(mean_intake, delta_lb, days_span)
    estimate = blend_tdee(formula_tdee, observed, days_span)

    ideal = estimate + target_rate_lb_per_week * KCAL_PER_LB_PER_WEEK
    change = max(-MAX_CHANGE_KCAL, min(MAX_CHANGE_KCAL, ideal - current_kcal))
    new_kcal = current_kcal + change

    direction = "up" if change > 0 else "down" if change < 0 else "unchanged"
    if direction == "unchanged":
        explanation = (
            f"You're gaining about {observed_rate:.2f} lb/week against a target of "
            f"{target_rate_lb_per_week:.2f}. That's on plan, so your target stays at "
            f"{round(new_kcal)} kcal."
        )
    else:
        explanation = (
            f"You're changing about {observed_rate:+.2f} lb/week against a target of "
            f"{target_rate_lb_per_week:+.2f}, and your logged intake suggests you burn "
            f"about {round(observed)} kcal/day. Calories go {direction} "
            f"{abs(round(change))} to {round(new_kcal)} kcal."
        )

    return Recommendation(
        adjusted=change != 0,
        new_kcal=new_kcal,
        explanation=explanation,
        days_of_data=days_span,
        observed_rate_lb_per_week=observed_rate,
        observed_tdee=observed,
    )
