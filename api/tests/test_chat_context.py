from datetime import date

import pytest

from chat import DayRow, build_summary, summarise_history


PROFILE = {
    "goal": "gain", "rate_lb_per_week": 0.5, "sex": "male", "weight_kg": 67,
    "height_cm": 179, "age": 20, "activity_level": "moderate",
    "cuisines": ["South Indian"], "exclusions": ["Seafood"],
}

TODAY = date(2026, 7, 24)


def rows(*specs) -> list[DayRow]:
    return [DayRow(day=d, kcal=k, protein_g=p, carbs_g=0, fat_g=0, meals=m) for d, k, p, m in specs]


def test_summary_states_today_against_target():
    text = build_summary(PROFILE, TODAY, rows((TODAY, 1200.0, 60.0, 2)))
    assert "1200" in text.replace(",", "")
    assert "60" in text
    # The target comes from the same deterministic engine the dashboard uses.
    assert "2875" in text.replace(",", "")
    assert "121" in text


def test_summary_reports_remaining_not_just_consumed():
    text = build_summary(PROFILE, TODAY, rows((TODAY, 1200.0, 60.0, 2)))
    assert "1675" in text.replace(",", "")  # 2875 - 1200


def test_summary_handles_a_day_with_no_meals():
    # A brand-new user must not produce a summary full of nulls or a crash.
    text = build_summary(PROFILE, TODAY, [])
    assert "no meals" in text.lower()
    assert "2875" in text.replace(",", "")


def test_summary_averages_only_days_that_were_logged():
    # Averaging across 7 calendar days when only 2 were logged understates
    # intake badly and would make the Coach give wrong advice.
    text = build_summary(PROFILE, TODAY, rows(
        (date(2026, 7, 24), 2000.0, 100.0, 3),
        (date(2026, 7, 23), 3000.0, 140.0, 4),
    ))
    assert "2500" in text.replace(",", "")  # mean of the 2 logged days, not /7
    assert "2 of the last 7 days" in text


def test_summary_includes_profile_context():
    text = build_summary(PROFILE, TODAY, [])
    assert "South Indian" in text
    assert "Seafood" in text
    assert "gain" in text.lower()


def test_history_is_capped_and_keeps_the_most_recent():
    history = [{"role": "user", "content": f"m{i}"} for i in range(50)]
    kept = summarise_history(history, limit=20)
    assert len(kept) == 20
    assert kept[-1]["content"] == "m49"
    assert kept[0]["content"] == "m30"


def test_history_shorter_than_the_cap_is_untouched():
    history = [{"role": "user", "content": "hi"}]
    assert summarise_history(history, limit=20) == history
