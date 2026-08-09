from datetime import date, timedelta

import pytest

from adaptive import (
    ADHERENCE_THRESHOLD,
    ALPHA,
    KCAL_PER_LB_BODY,
    MAX_CHANGE_KCAL,
    MIN_CHANGE_KCAL,
    MIN_DAYS,
    DayIntake,
    WeighIn,
    blend_tdee,
    ema_series,
    observed_tdee,
    recommend_target,
)


def weigh_ins(start: date, kgs: list[float]) -> list[WeighIn]:
    return [WeighIn(measured_on=start + timedelta(days=i), weight_kg=kg) for i, kg in enumerate(kgs)]


def intake(start: date, kcals: list[float]) -> list[DayIntake]:
    return [DayIntake(day=start + timedelta(days=i), kcal=k) for i, k in enumerate(kcals)]


# --- exponential moving average -------------------------------------------

def test_ema_starts_at_the_first_reading():
    assert ema_series([70.0])[0] == pytest.approx(70.0)


def test_ema_absorbs_a_one_day_spike():
    # A salty meal can add 2kg of water overnight. The EMA must barely move,
    # or a single bad reading would look like real fat gain.
    flat = ema_series([70.0, 70.0, 70.0, 70.0])
    spiked = ema_series([70.0, 70.0, 72.0, 70.0])
    assert spiked[-1] - flat[-1] < 0.5


def test_ema_tracks_a_sustained_change_within_a_week():
    values = [70.0] + [71.0] * 7
    assert ema_series(values)[-1] == pytest.approx(71.0, abs=0.2)


def test_ema_weights_the_newest_reading_by_alpha():
    assert ema_series([70.0, 80.0])[1] == pytest.approx(ALPHA * 80 + (1 - ALPHA) * 70)


# --- observed TDEE ---------------------------------------------------------

def test_gaining_weight_means_tdee_is_below_intake():
    # Ate 2500/day for 14 days and gained 1 lb: they were in surplus, so their
    # real burn is below what they ate. Getting this sign backwards would make
    # the engine push calories the wrong way.
    result = observed_tdee(mean_intake=2500, delta_lb=1.0, days=14)
    assert result == pytest.approx(2500 - (1.0 * KCAL_PER_LB_BODY / 14))
    assert result < 2500


def test_losing_weight_means_tdee_is_above_intake():
    result = observed_tdee(mean_intake=2000, delta_lb=-1.0, days=14)
    assert result == pytest.approx(2000 + (1.0 * KCAL_PER_LB_BODY / 14))
    assert result > 2000


def test_stable_weight_means_tdee_equals_intake():
    assert observed_tdee(mean_intake=2300, delta_lb=0.0, days=14) == pytest.approx(2300)


# --- blending formula into observed ---------------------------------------

def test_below_two_weeks_the_formula_is_used_unchanged():
    assert blend_tdee(formula=2600, observed=3000, days=13) == pytest.approx(2600)


def test_at_four_weeks_the_observed_value_is_trusted_fully():
    assert blend_tdee(formula=2600, observed=3000, days=28) == pytest.approx(3000)


def test_three_weeks_sits_halfway():
    assert blend_tdee(formula=2600, observed=3000, days=21) == pytest.approx(2800)


def test_blend_never_extrapolates_past_the_observed_value():
    assert blend_tdee(formula=2600, observed=3000, days=90) == pytest.approx(3000)


# --- the full recommendation ----------------------------------------------

START = date(2026, 7, 1)


def steady_gain(days: int, kcal: float, kg_per_day: float, start_kg: float = 67.0):
    """A user eating `kcal` daily whose weight moves `kg_per_day`."""
    return (
        weigh_ins(START, [start_kg + kg_per_day * i for i in range(days)]),
        intake(START, [kcal] * days),
    )


def test_no_recommendation_before_two_weeks_of_data():
    ws, ins = steady_gain(10, 2800, 0.01)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.adjusted is False
    assert "14 days" in result.explanation


def test_gaining_too_slowly_raises_calories():
    # Target is 0.5 lb/week but they're barely gaining, so they need to eat more.
    ws, ins = steady_gain(28, 2800, 0.005)  # ~0.077 lb/day is well under target
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.adjusted is True
    assert result.new_kcal > 2875


def test_gaining_too_fast_on_target_intake_lowers_calories():
    # They ate their target and still gained fast, so their real burn is below
    # what the formula assumed and the target must come down.
    ws, ins = steady_gain(28, 2875, 0.09)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.adjusted is True
    assert result.new_kcal < 2875


def test_overeating_the_target_raises_it_rather_than_punishing_the_user():
    # Ate 3400 against a 2875 target and gained fast. The naive reading is
    # "gaining too fast, cut calories" -- but the surplus explains the gain, and
    # the measured burn (which subtracts it) comes out ABOVE the formula's
    # guess. So 2875 was too low for a 0.5 lb/week goal all along.
    ws, ins = steady_gain(28, 3400, 0.09)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.observed_tdee > 2625
    assert result.new_kcal > 2875


def test_a_change_is_capped_so_one_odd_week_cannot_swing_the_target():
    ws, ins = steady_gain(28, 4500, 0.25)  # wildly off; uncapped this moves hundreds
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert abs(result.new_kcal - 2875) <= MAX_CHANGE_KCAL


def test_poor_logging_blocks_any_adjustment():
    # Intake is only known for the days that were logged. With half of them
    # missing, mean intake reads low and the engine would cut calories from
    # someone who merely forgot to log -- the worst failure available to it.
    ws, _ = steady_gain(28, 2800, 0.01)
    sparse = intake(START, [2800] * 28)[:10]  # 10 of 28 days, under the threshold
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=sparse)
    assert result.adjusted is False
    assert "logged" in result.explanation.lower()


def test_adherence_threshold_is_the_documented_seventy_percent():
    assert ADHERENCE_THRESHOLD == pytest.approx(0.7)
    assert MIN_DAYS == 14


def test_explanation_names_the_numbers_a_user_could_check():
    ws, ins = steady_gain(28, 2800, 0.005)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    # A target that moves without a checkable reason reads as a bug.
    assert str(round(result.new_kcal)) in result.explanation.replace(",", "")
    assert "kcal" in result.explanation


def test_holding_the_target_rate_leaves_calories_alone():
    # Already gaining at ~0.5 lb/week (0.0324 kg/day) on 2800 kcal.
    ws, ins = steady_gain(28, 2800, 0.0324)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert abs(result.new_kcal - 2875) < 60


def test_only_one_adjustment_per_week():
    # The cap is 150 kcal PER WEEK. Adjusting on every weigh-in would let a
    # daily weigher move their target 150x7 in a week and defeat the whole
    # stability guarantee -- a live run produced 14 changes in 28 days.
    ws, ins = steady_gain(28, 2800, 0.005)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins,
                              days_since_last_change=3)
    assert result.adjusted is False
    assert result.new_kcal == 2875
    assert "week" in result.explanation.lower()


def test_a_week_after_the_last_change_it_may_adjust_again():
    ws, ins = steady_gain(28, 2800, 0.005)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins,
                              days_since_last_change=7)
    assert result.adjusted is True


def test_trivial_changes_are_not_recorded():
    # A 6 kcal move is noise. Writing it creates a history row that says
    # nothing and makes real changes harder to spot.
    ws, ins = steady_gain(28, 2800, 0.0324)  # already on plan
    result = recommend_target(current_kcal=2831, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.adjusted is False
    assert abs(result.new_kcal - 2831) < MIN_CHANGE_KCAL


def test_result_reports_what_it_measured():
    ws, ins = steady_gain(28, 2800, 0.0324)
    result = recommend_target(current_kcal=2875, target_rate_lb_per_week=0.5,
                              formula_tdee=2625, weights=ws, intakes=ins)
    assert result.observed_rate_lb_per_week == pytest.approx(0.5, abs=0.1)
    assert result.days_of_data == 28
