"""Which Gemini model each job uses.

In one file because it was previously hardcoded in four, which made this
migration a four-file edit instead of one.

**Gemini 2.5 is closed to new API keys.** An existing key can still call it,
but a key issued now gets `404 ... no longer available to new users`, so this
project runs on Gemini 3.

Measured on the real API when choosing between the Gemini 3 options, same
prompts, same photo:

    gemini-3-flash-preview   8.1s / 14.1s / 37.6s  (and 54s on a text meal,
                                                    plus intermittent 503s)
    gemini-3.1-flash-lite    1.4s / 1.9s / 2.0s

Both identified the same foods at the same weights, and both still produced
the hidden-fat question. `3-flash-preview` is a *preview* model: capacity
isn't guaranteed, and a minute-long wait to log lunch is a product-killing
regression. Lite is faster, steadier and cheaper.

Pinned to a concrete version rather than the `-latest` alias. An alias can
change underneath a set of carefully tuned prompts without anything failing
loudly, which is the worst way to find out.

**Worth revisiting once the Phase 4 eval suite exists.** The choice above
rests on a handful of hand-checked meals. A smaller model may well be worse on
genuinely hard plates -- mixed dishes, poor lighting -- and the eval set is the
honest way to settle that rather than guessing from two examples.
"""

# Photo/text -> identified foods. The call the whole product rests on.
VISION = "gemini-3.1-flash-lite"

# Coach and Foodie. Thinking is switched off at the call site: chat is judged
# on time-to-first-word, and the numbers arrive precomputed from SQL.
CHAT = "gemini-3.1-flash-lite"

# Both are transcription -- reading what is already there rather than judging.
TRANSCRIBE = "gemini-3.1-flash-lite"
LABEL = "gemini-3.1-flash-lite"

# Reading the fat type and amount off a photo of the oil used.
FAT_PHOTO = "gemini-3.1-flash-lite"

EMBEDDING = "gemini-embedding-001"

# Test fixtures only -- used to synthesise speech so voice input can be
# verified without a person talking. Never called by the app.
TTS = "gemini-2.5-flash-preview-tts"
