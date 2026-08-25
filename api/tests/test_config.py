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


class _FakeQuery:
    def __init__(self, log, fail):
        self.log, self.fail = log, fail

    def select(self, *_):
        return self

    def limit(self, *_):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("connection refused")
        self.log.append("executed")
        return None


class _FakeClient:
    def __init__(self, log, fail=False):
        self.log, self.fail = log, fail

    def table(self, name):
        self.log.append(name)
        return _FakeQuery(self.log, self.fail)


def _client(monkeypatch, log, fail=False):
    import deps
    monkeypatch.setattr(deps, "anon_client", lambda: _FakeClient(log, fail))
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)


def test_the_keepalive_ping_really_queries_the_database(monkeypatch):
    # The whole reason this endpoint exists: a ping that does not reach
    # Postgres lets Supabase pause while every check still passes.
    log = []
    response = _client(monkeypatch, log).get("/health/db")
    assert response.status_code == 200
    assert log == ["recipes", "executed"]


def test_plain_health_does_not_touch_the_database(monkeypatch):
    # Confirms the two endpoints are genuinely different, so pointing the
    # keep-alive at /health would not work and this one is not redundant.
    log = []
    assert _client(monkeypatch, log).get("/health").status_code == 200
    assert log == []


def test_an_unreachable_database_is_reported_not_swallowed(monkeypatch):
    log = []
    response = _client(monkeypatch, log, fail=True).get("/health/db")
    assert response.status_code == 503


def test_a_request_with_no_token_is_rejected_as_unauthorised():
    # A missing Authorization header means "log in", not "your request was
    # malformed" -- so it must be a 401, not the 422 a required header gives.
    from fastapi.testclient import TestClient
    import main
    assert TestClient(main.app).get("/meals").status_code == 401
