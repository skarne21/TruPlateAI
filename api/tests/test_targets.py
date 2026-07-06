import pytest
from targets import calculate_targets, TargetsInput


def test_bmr_male_mifflin_st_jeor():
    # 30yo male, 80kg, 180cm: 10*80 + 6.25*180 - 5*30 + 5 = 800+1125-150+5 = 1780
    profile = TargetsInput(
        sex="male", weight_kg=80, height_cm=180, age=30,
        activity_level="sedentary", goal="recomp", rate_lb_per_week=0,
    )
    result = calculate_targets(profile)
    assert result.bmr == pytest.approx(1780, abs=1)


def test_bmr_female_mifflin_st_jeor():
    # 25yo female, 60kg, 165cm: 10*60 + 6.25*165 - 5*25 - 161 = 600+1031.25-125-161 = 1345.25
    profile = TargetsInput(
        sex="female", weight_kg=60, height_cm=165, age=25,
        activity_level="sedentary", goal="recomp", rate_lb_per_week=0,
    )
    result = calculate_targets(profile)
    assert result.bmr == pytest.approx(1345.25, abs=1)


def test_activity_multiplier_applied_to_tdee():
    profile = TargetsInput(
        sex="male", weight_kg=80, height_cm=180, age=30,
        activity_level="moderate", goal="recomp", rate_lb_per_week=0,
    )
    result = calculate_targets(profile)
    assert result.tdee == pytest.approx(1780 * 1.55, abs=1)


def test_gain_goal_adds_kcal_per_rate():
    profile = TargetsInput(
        sex="male", weight_kg=80, height_cm=180, age=30,
        activity_level="sedentary", goal="gain", rate_lb_per_week=0.5,
    )
    result = calculate_targets(profile)
    # sedentary multiplier is 1.2, so TDEE (not raw BMR) is the goal-adjustment base
    assert result.kcal_target == pytest.approx(1780 * 1.2 + 0.5 * 500, abs=1)


def test_lose_goal_subtracts_kcal_per_rate():
    profile = TargetsInput(
        sex="female", weight_kg=60, height_cm=165, age=25,
        activity_level="sedentary", goal="lose", rate_lb_per_week=1.0,
    )
    result = calculate_targets(profile)
    # sedentary multiplier is 1.2, so TDEE (not raw BMR) is the goal-adjustment base
    assert result.kcal_target == pytest.approx(1345.25 * 1.2 - 1.0 * 500, abs=1)


def test_protein_target_scales_with_bodyweight_and_goal():
    profile = TargetsInput(
        sex="male", weight_kg=80, height_cm=180, age=30,
        activity_level="sedentary", goal="gain", rate_lb_per_week=0.5,
    )
    result = calculate_targets(profile)
    assert result.protein_g == pytest.approx(80 * 1.8, abs=1)


def test_rejects_unsafe_rate():
    with pytest.raises(ValueError):
        TargetsInput(
            sex="male", weight_kg=80, height_cm=180, age=30,
            activity_level="sedentary", goal="lose", rate_lb_per_week=3.0,
        )
