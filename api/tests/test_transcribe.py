import pytest

from transcribe import (
    TRANSCRIBE_PROMPT,
    Transcript,
    build_transcribe_prompt,
    frequent_foods,
    transcribe_audio,
)


class FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class FakeClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return FakeQuery(self._rows)


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


class FakeGemini:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self._responses.pop(0)


def test_frequent_foods_ranks_by_how_often_they_appear():
    client = FakeClient([
        {"name": "Idli"}, {"name": "Sambar"}, {"name": "Idli"},
        {"name": "Idli"}, {"name": "Sambar"}, {"name": "Chutney"},
    ])
    assert frequent_foods(client, "user-a", limit=2) == ["Idli", "Sambar"]


def test_frequent_foods_is_empty_for_a_new_user():
    assert frequent_foods(FakeClient([]), "user-a") == []


def test_prompt_biases_towards_foods_the_user_actually_eats():
    # Without this "idli" comes back as "it'll" or "idly" -- the whole reason
    # the transcription is per-user rather than generic.
    prompt = build_transcribe_prompt(["Idli", "Sambar"])
    assert "Idli" in prompt and "Sambar" in prompt


def test_prompt_is_usable_with_no_history():
    prompt = build_transcribe_prompt([])
    assert "Idli" not in prompt
    assert len(prompt) > 100  # still a complete instruction


def test_prompt_forbids_inventing_food():
    # A transcriber that adds a food the user never said would silently log
    # calories they never ate.
    lowered = TRANSCRIBE_PROMPT.lower()
    assert "never add" in lowered or "do not add" in lowered
    assert "self-correct" in lowered or "corrects themselves" in lowered


def test_transcribe_returns_the_cleaned_text():
    gemini = FakeGemini([FakeResponse(parsed=Transcript(text="three idlis and sambar"))])
    assert transcribe_audio(b"audio", "audio/webm", [], client=gemini) == "three idlis and sambar"


def test_transcribe_falls_back_to_parsing_raw_json():
    gemini = FakeGemini([FakeResponse(parsed=None, text='{"text": "two dosas"}')])
    assert transcribe_audio(b"audio", "audio/webm", [], client=gemini) == "two dosas"


def test_transcribe_sends_the_audio_and_the_prompt():
    gemini = FakeGemini([FakeResponse(parsed=Transcript(text="ok"))])
    transcribe_audio(b"rawbytes", "audio/ogg", ["Idli"], client=gemini)

    contents = gemini.calls[0]["contents"]
    assert len(contents) == 2  # audio part + prompt
    assert "Idli" in contents[1]


def test_unusable_audio_yields_empty_text_not_an_invented_meal():
    # Silence must produce nothing, so the caption stays empty and the user is
    # never handed food they didn't say.
    gemini = FakeGemini([FakeResponse(parsed=Transcript(text="   "))])
    assert transcribe_audio(b"", "audio/webm", [], client=gemini) == ""
