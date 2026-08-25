"""The API's deployment-time configuration."""

from main import _origins


def test_default_is_the_local_front_end():
    assert _origins("http://localhost:3000") == ["http://localhost:3000"]


def test_several_origins_split_on_commas():
    assert _origins("https://a.app,https://b.app") == ["https://a.app", "https://b.app"]


def test_spaces_after_commas_are_ignored():
    # Writing the variable with spaces is natural, and an un-stripped origin
    # never matches the browser's Origin header -- a silent, total failure.
    assert _origins("https://a.app, https://b.app") == ["https://a.app", "https://b.app"]


def test_empty_entries_are_dropped():
    # A trailing comma would otherwise contribute "" as an allowed origin.
    assert _origins("https://a.app,,") == ["https://a.app"]


def test_unset_value_yields_nothing_rather_than_a_blank_origin():
    assert _origins("") == []
