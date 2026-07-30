import json

import pytest

from routes.chat import stream_ndjson


def collect(gen) -> list[dict]:
    return [json.loads(line) for line in gen if line.strip()]


def test_streams_chunks_then_a_done_line():
    saved = {}

    def fake_reply():
        yield "You have "
        yield "60g left."

    lines = collect(stream_ndjson(fake_reply(), on_complete=lambda text: saved.update(text=text)))

    assert [l["text"] for l in lines if l["type"] == "chunk"] == ["You have ", "60g left."]
    assert lines[-1]["type"] == "done"
    # The full reply is persisted once, after streaming finishes -- so history
    # never contains half a sentence attributed to the Coach.
    assert saved["text"] == "You have 60g left."


def test_every_line_is_valid_standalone_json():
    def fake_reply():
        yield 'text with "quotes" and \n newlines'

    for line in stream_ndjson(fake_reply(), on_complete=lambda _: None):
        if line.strip():
            json.loads(line)  # would raise if framing were broken


def test_midstream_failure_emits_an_error_line_not_a_silent_truncation():
    def failing_reply():
        yield "Here's the plan"
        raise RuntimeError("gemini fell over")

    lines = collect(stream_ndjson(failing_reply(), on_complete=lambda _: None))

    assert lines[0] == {"type": "chunk", "text": "Here's the plan"}
    assert lines[-1]["type"] == "error"
    # The response already committed to HTTP 200 when the first chunk went out,
    # so a failure has to travel inside the stream rather than as a status code.
    assert "message" in lines[-1]


def test_partial_reply_is_not_persisted_on_failure():
    saved = {}

    def failing_reply():
        yield "half an answ"
        raise RuntimeError("boom")

    collect(stream_ndjson(failing_reply(), on_complete=lambda text: saved.update(text=text)))
    assert saved == {}


def test_empty_reply_still_terminates_cleanly():
    lines = collect(stream_ndjson(iter(()), on_complete=lambda _: None))
    assert lines == [{"type": "done"}] or lines[-1]["type"] == "done"
