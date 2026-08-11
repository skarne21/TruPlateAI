# TruPlate AI — Build Log

The story of this project in the order it happened, written so that someone
who doesn't code can follow along and pick up the ideas as they appear.

Every programming concept is explained the first time it shows up. Nothing
assumes you've seen it before.

**Why this file exists.** Git already records every line that changed. What it
can't hold is *why* — what we were trying to do, what the tests told us, what
turned out to be wrong, and what changed as a result. That's what's here.

> **What's a "test"?**
> A small piece of code whose only job is to check that another piece of code
> does what you claimed. You write down an example — "a 30-year-old man
> weighing 80kg should burn about 1780 calories at rest" — and the computer
> re-checks it every time anything changes. If you break it six weeks later,
> the test complains immediately instead of you finding out from a wrong
> number on screen.
>
> This project has **127** of them. They run in about 4 seconds.

> **What's a "commit"?**
> A saved checkpoint, with a note explaining what changed and why. Like a save
> point in a game you can always return to. Each `abc1234` below is one.

**Keeping this updated:** add to it as you build. Only write what a list of
changed lines *wouldn't* tell you.

---

## Contents

- [Week 1 — Foundations](#week-1--foundations-6-july)
- [Week 2 — The front end appears](#week-2--the-front-end-appears-1223-july)
- [Week 3 — Photos become calories](#week-3--photos-become-calories-24-july)
- [Week 4 — The Coach](#week-4--the-coach-30-july--6-august)
- [Week 5 — The app learns your body](#week-5--the-app-learns-your-body-9-august)
- [Week 6 — The app remembers your meals](#week-6--the-app-remembers-your-meals-10-august)
- [Every bug, and what it taught](#every-bug-and-what-it-taught)
- [Where things stand](#where-things-stand)

---

# Week 1 — Foundations (6 July)

Goal: get the skeleton standing. No AI yet, no photos. Just prove the pieces
can talk to each other.

## The very first commits — `6132b67`, `c64eb03`

A README, then a rename: the project started as "macrosnap" and became
"TruPlate AI".

Renaming early is deliberate. A name ends up in file paths, database names and
URLs; changing it later means touching all of them.

## The backend starts breathing — `228df7b`

**Added:** `api/main.py` (21 lines), `api/requirements.txt`, `api/.env.example`

> **What's a "backend"?**
> Software has two halves. The **frontend** is what you see and touch — pages,
> buttons, the camera. The **backend** is a program running on a server that
> the frontend talks to: it does the real work and holds the secrets.
>
> They're separate because you can't trust anything on a phone. Anyone can
> open a browser's developer tools and read every line the frontend runs. So
> passwords and API keys live only in the backend, where users can't see them.

The first backend had exactly one feature — a `/health` address that replies
`{"ok": true}`. Useless to a user, essential to a developer: it answers "is
this thing even running?" before you go hunting for subtler problems.

> **What's an "endpoint"?**
> A specific address the backend answers on, like a phone extension.
> `/health` asks "are you alive?". Later we added `/analyze` ("here's a photo,
> what food is it?") and `/log` ("save this meal"). Each does one job.

**Also configured: CORS.** By default a browser refuses to let a page from one
address talk to a program at a different address — a security rule, since
otherwise any website could quietly make requests to your bank. Our frontend
and backend *are* at different addresses, so the backend has to explicitly say
"the page at localhost:3000 is allowed to talk to me."

Remember CORS. It causes three of this project's most confusing bugs.

## The first real logic, written test-first — `493a58e`

**Added:** `api/targets.py` (79 lines), `api/tests/test_targets.py` (68 lines,
**7 tests**)

This calculates how many calories you should eat. It uses the **Mifflin-St
Jeor equation**, the standard formula for resting metabolism:

```
men:   10 × weight_kg + 6.25 × height_cm − 5 × age + 5
women: 10 × weight_kg + 6.25 × height_cm − 5 × age − 161
```

That's calories burnt doing nothing. Multiply by an activity factor (1.2 for
desk-bound up to 1.9 for very active), then add or subtract for your goal —
500 calories a day is roughly a pound a week, since a pound of body fat holds
about 3500 calories.

> **What's "test-driven development" (TDD)?**
> Backwards from how it sounds sensible. You write the test **first**, watch
> it fail, then write code until it passes.
>
> Writing the test first forces you to decide what "correct" means before you
> can talk yourself into whatever the code happens to do. Watching it fail
> first matters too — a test that passes before you've written anything isn't
> testing anything.

### What the tests said

Two of the seven tests failed for a reason I didn't expect: **my expected
numbers were wrong, not the code.** I'd calculated the answers using resting
metabolism where I should have used resting metabolism × activity factor.

**What changed:** the test values were corrected, not the code. This is TDD
working exactly as intended — the disagreement surfaced immediately, and
checking which side was wrong took a minute. Had I written the code first, I'd
have "confirmed" it with the same wrong arithmetic.

**Running total: 7 tests.**

## Checking the outside world exists — `87802b7`

**Added:** `api/scripts/test_gemini.py`, `api/scripts/test_usda.py`

Two throwaway scripts. One sends a photo to Google's AI and prints what comes
back. One asks the USDA food database about "idli" and prints the calories.

Neither is part of the app. They exist to answer "do my API keys work at all?"
before building anything on top. Discovering a broken key after writing 500
lines that depend on it is a bad afternoon; discovering it in a 12-line script
is a shrug.

> **What's an "API key"?**
> A password for a program rather than a person. Google's AI needs to know
> who's asking so they can bill it and stop abuse. Anyone with your key can
> spend your money, which is why they live in the backend and never in the
> frontend.

## The database, with a lock on every table — `f4982af`

**Added:** `supabase/migrations/0001_profiles.sql` (31 lines)

> **What's a "migration"?**
> A file describing a change to the database's structure — "add a table called
> profiles with these columns". They're numbered and kept forever, so the
> database can be rebuilt from scratch by replaying them in order. Without
> them, the shape of your database only exists as whatever someone clicked in
> an admin panel once.

This created the `profiles` table — one row per user, holding height, weight,
goal, cuisines and food exclusions.

The important half is four extra lines:

```sql
alter table public.profiles enable row level security;

create policy "Users can select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);
```

> **What's "Row Level Security" (RLS)?**
> Normally the database hands over any row you ask for, and it's the app's job
> to only ask for the right ones. RLS moves that rule into the database
> itself: "a user may only see rows where the user_id column equals their own
> ID."
>
> The point is that it holds **even if the app has a bug.** If a developer
> forgets a filter, the database still refuses. It's a second lock on the
> door, independent of the first.
>
> This project's rival, Cal AI, leaked 3.2 million user records in March 2026
> through a backend with no such protection. Every table here has RLS from the
> moment it's created.

## Logging in, and a subtlety worth understanding — `dc013b7`

**Added:** `api/deps.py` (22 lines), `api/pytest.ini`. **Changed:** `main.py`.

> **What's a "JWT"?**
> When you log in, the server hands you a **token** — a long string that
> proves who you are, signed so it can't be faked or edited. Your browser
> sends it with every subsequent request, so the server doesn't have to ask
> "who are you?" each time.
>
> Like a wristband at a festival: checked once at the gate, then just shown.

Here's the subtle part. The backend *could* connect to the database as an
administrator, which can read everything. Instead it deliberately connects
**as the logged-in user**, using their token:

```python
client.postgrest.auth(token)
```

Giving up power on purpose. If the backend connected as an administrator, RLS
would be pointless — an admin bypasses it. By connecting as the user, the
lock from `f4982af` actually applies to real traffic.

`pytest.ini` was added because the test runner was trying to run
`scripts/test_gemini.py` as a test — the filename starts with `test_`, which
is the pattern it looks for. One line told it to only look in the `tests`
folder.

---

# Week 2 — The front end appears (12–23 July)

## A small bug with a general lesson — `e6d7481`

The Gemini script opened `"test_meal.jpg"`, which works only if you run it
from the exact folder that file is in. From anywhere else: "file not found".

**The fix:**

```python
Path(__file__).parent / "test_meal.jpg"
```

`__file__` is the script's own location, so it now finds the photo next to
itself no matter where it's run from. **"Works on my machine, breaks from a
different folder"** is one of the most common bugs there is, and this is the
standard cure.

## The website — `8685eee`, `236cb85`

**Added:** the whole Next.js frontend, plus login and signup pages, plus
`web/proxy.ts`.

> **What's a "framework"?**
> A pre-built skeleton for a common kind of program, so you're not starting
> from nothing. Next.js is a framework for websites: it handles page routing,
> bundling, and rendering, leaving you to write the parts specific to your
> app.

A warning file in the project (`web/AGENTS.md`) says this version of Next.js
has changes that most documentation won't reflect. That turned out to matter
immediately: the file that runs code on every request used to be called
`middleware.ts`, and in this version it's `proxy.ts`. Following a tutorial
would have produced a file that silently did nothing.

Its job here is refreshing your login token in the background so your session
doesn't expire while you're using the app.

## A bug that made no noise at all — `72d5a73`

You could set your training days in the signup questionnaire. The value went
nowhere.

**The cause:** the backend describes the shape of data it expects, and the
library that checks it (**Pydantic**) **silently discards anything not on that
list.** `gym_days` wasn't listed, so it was thrown away without complaint.

```python
class ProfileIn(TargetsInput):
    gym_days: int = 0          # ← this line was missing
```

> **Why "typed" code helps.**
> Declaring in advance that `gym_days` is a whole number lets tools catch
> mistakes before the program ever runs. The catch, shown here: a field you
> forget to declare doesn't error — it *vanishes*. Silent failures are the
> expensive kind, because nothing points at them.

**How it was caught:** not by any test. By logging in, filling the form, then
going and *looking in the database* to check the value had arrived.

## The questionnaire — `a5ca5e9`

**Added:** the four-step onboarding wizard, a reusable `ChipGroup` component,
and `lib/units.ts`.

One idea worth stealing: **the app always stores height in centimetres and
weight in kilograms**, because the formula needs those. But you can type feet,
inches and pounds. Conversion happens only at the edge, where you type.

Keeping one canonical unit everywhere internally, and converting only for
display, avoids an entire category of bug where half the code assumes pounds
and the other half assumes kilos.

## The first fake CORS error — `b662af1`

Visiting the dashboard before finishing signup produced a browser error saying
the request was **blocked by CORS policy**.

It had nothing to do with CORS.

The real cause: the backend hit a situation it didn't handle (looking for a
profile that doesn't exist), and crashed. When a program crashes mid-request,
an emergency handler produces a generic error page — and **that handler sits
outside the layer that adds the CORS headers.** So the reply arrives without
them, and the browser, seeing no permission header, reports a CORS problem.

The browser is describing the symptom. The disease is an unhandled crash.

**The fix** was to catch that situation and return a proper "not found":

```python
except APIError as e:
    if e.code == "PGRST116":       # no rows found
        raise HTTPException(404, "Profile not found")
```

**The lesson, and it comes up twice more:** when the browser says "CORS",
check the *server's* log before touching any CORS configuration.

## The dashboard, and a race — `d033d50`

**Added:** `web/app/dashboard/page.tsx` (164 lines).

> **What's a "race condition"?**
> When two things happen at once and the result depends on which finishes
> first. Named for two runners where you don't know who wins.

Loading the dashboard means asking the server for your numbers and waiting.
Log out and back in quickly, and *two* such requests are in flight. If the
older one finishes last, it overwrites the fresh data with stale data.

The standard fix — a flag saying "this request no longer matters":

```javascript
let cancelled = false;
// ...
if (cancelled) return;      // checked before using any result
return () => { cancelled = true; };   // set when leaving the page
```

**How it was caught:** by clicking through logout and login quickly in a real
browser. No test would have found it, because tests do one thing at a time —
and this bug only exists when two things overlap.

**End of Phase 0. Running total: 7 tests.** A user could sign up, answer
questions, see personalised targets, and find them still there tomorrow.

---

# Week 3 — Photos become calories (24 July)

The core of the product. Photograph food, get real numbers.

## Designing first, and being wrong in the cheapest way — `48b0725`, `3fe5dba`

**Added:** a written design document before any code.

The plan said: when looking up food in the USDA database, prefer the
"Foundation" and "SR Legacy" categories, because they sound the most
authoritative.

**Ten minutes of testing against the real database showed this was backwards.**

Those categories contain *raw ingredients* — uncooked rice, a stick of butter.
There's a separate category, `Survey (FNDDS)`, for *prepared dishes*. A photo
of dinner contains prepared dishes.

Tested across 8 foods, the "authoritative" categories were wrong every single
time:

| Searching for | The "authoritative" answer | The right answer |
|---|---|---|
| sambar (a lentil stew) | **"Chicken, stewing"** | "Sambar, vegetable stew" |
| dosa | "Dumpling, frozen" | "Dosa, with filling" |
| idli | "Rice, Chinese restaurant" | "Idli" |

That first row would have logged **meat macros for a vegetarian dish**, for a
user whose profile says no seafood and South Indian food.

**What changed:** the strategy was reversed before a line of code existed.
Testing an assumption about someone else's system, *before* building on it, is
about the cheapest thing you can do.

## The AI layer and the numbers layer — `0a3ba44`

**Added:** `api/usda.py` (87), `api/vision.py` (245), `api/analysis.py` (218),
three test files, and a large file of saved USDA responses.

**Running total: 7 → 41 tests.**

The single most important rule in this project:

> **The AI never supplies a calorie number.**
> It looks at the photo and says *"about 240 grams of banana"* — identification
> and portion, which is what vision is good at. Then real per-gram numbers
> come from the USDA database. AI models will confidently invent a plausible
> number; a database won't.

> **What are "fixtures"?**
> Saved copies of real responses from an outside service, kept in the project
> so tests can use them without going online. It means the test suite runs in
>4 seconds with no internet, and can't fail because someone else's server is
> down.

### What the tests said

Writing the tests forced two decisions that would otherwise have been made
carelessly:

**1. A missing number must not become zero.** If USDA has no calorie figure
for something, it's tempting to store `0`. But "we don't know" and "it's zero"
are different facts, and treating the first as the second silently
under-reports your day.

```python
def test_missing_nutrient_is_none_not_zero():
    assert macros["kcal"] is None      # not 0
```

**2. Match nutrients by number, not by name.** USDA lists "Energy" twice — once
in calories, once in kilojoules. Matching on the word would grab whichever
came first. Matching on the numeric ID (1008 = calories) is unambiguous.

## Splitting a file that got too big — `2bfc0ed`

**Added:** `api/routes/` folder, `0002_meals.sql`. `main.py` went from 44
lines of endpoints down to 6.

Two endpoints in one file is fine. Seven is not. The endpoints moved into
`routes/`, grouped by topic, leaving `main.py` to do only setup.

**A design decision worth explaining.** The `meal_items` table stores
`user_id` on every row, even though you could work it out by looking up its
parent meal. Duplicating it looks wasteful — but it lets the security rule be
a simple column comparison instead of a lookup that runs for every row. In
databases, a little duplication to make a security check cheap is a normal and
deliberate trade.

## The logging screen — `39fed4b`

**Added:** the `/log` page, the review screen, item search, and helpers for
calling the backend and shrinking images.

Photos are shrunk to 1024 pixels **in the browser, before sending.** A phone
photo is several megabytes and nothing here needs that detail. The same
shrunken copy is sent to the AI and later saved, so it's paid for once.

## The bug that justified the whole design — `a1d4d92`

The first real photo through the finished pipeline: two bananas.

**It logged 830 calories. The right answer is about 214.**

Searching USDA for `banana` returns "Bananas, **dehydrated**, or banana
powder" (346 cal per 100g) ranked above "Bananas, raw" (89 cal per 100g).
Dried fruit is far denser than fresh. Four times the answer.

The earlier testing had used descriptive multi-word searches like "idli
steamed rice cake", where the ranking is good. A single bare word is far more
ambiguous — and my confidence had come from a sample that shared a hidden
property.

**The fix uses something already available.** The AI had estimated ~87 calories
per 100g, which is right. So its estimate now acts as a **sanity check on the
match**: trust the database's ranking, *unless* the top result's calories are
more than double what the AI expected — then take the closest one instead.

**What the testing said about the obvious alternative:** simply picking
whichever entry was closest in calories fixed the banana and **broke dosa**,
matching it to "Crepe, chocolate filled". Relevance and plausibility each hold
real information and neither alone is enough. Relevance stays in charge;
calories only get a veto.

Measured across 9 foods: banana fixed, nothing else changed.

> This doesn't break the rule about AI never supplying numbers. The estimate
> only chooses *between database entries*. Every logged number still comes
> from USDA.

**Running total: 38 → 41 tests**, including one pinning the banana case
forever.

## A question that didn't match its own answers — `b1b5868`

The AI was writing the question text, and produced:

> **"How was the sambar prepared?"**
> `none` · `1 tsp total` · `1 tbsp total` · `2+ tbsp total`

The buttons don't answer that question.

The code already decided what the options were and what each was worth — so it
should write the wording too. Now it produces *"How much oil or ghee went into
the Sambar and Coconut Chutney?"*, built from the items the AI flagged.

**Lesson:** if two things must agree, one place should own both.

**Running total: 42 tests.**

## Fake CORS error, the second — `abd9fe2`

Same symptom, new cause: Google's AI returned **"503 — currently experiencing
high demand"**, that wasn't handled, the request crashed, and the browser again
blamed CORS.

Rather than patching the one endpoint, the fix went to the shared point every
AI call passes through, so neither caller can reintroduce it.

The same gap existed for USDA, which allows 1000 requests per hour and uses
one per food — so it's a matter of *when*, not *if*. There, failing the whole
meal would be wrong: a USDA outage now falls back to the AI's estimate for
that item (clearly labelled as an estimate) instead of losing your log.

**Running total: 45 tests.**

## Four bugs found by re-reading the code — `537294d`

No new feature. Just reading back what had been written.

**1. Hand-added items counted as zero carbs and zero fat.** The search endpoint
only returned calories and protein, so anything you added by hand quietly
understated the meal.

**2. Image previews leaked memory.** When you show a selected photo, the
browser creates a temporary handle that must be released by hand. The cleanup
code captured the photo list from the *first* moment the page loaded — when it
was empty — so it released nothing.

Worse: a warning tool had flagged this, and an earlier version of the code
**switched the warning off** rather than fixing it. Silencing a warning is a
decision to be wrong later.

**3. The website's front page was still a debug screen** showing
`API health: {"ok":true}` to anyone who visited.

**4. Login and signup were still unstyled** while every other page used the
design system. They *worked*, so nothing forced the issue — which is exactly
how visual debt survives.

> **A note on fixing #2.** My first attempt was rejected by the same warning
> tool for a different reason (you're not allowed to write to that kind of
> variable while the page is drawing). The second attempt was correct. The
> tool was right both times — which is the argument for having it.

**Running total: 48 tests. End of Phase 1.** Photograph a meal, answer a
question about cooking oil, see honest numbers, log it.

---

# Week 4 — The Coach (30 July – 6 August)

An assistant that answers from your actual data.

## Measuring before designing — `651af92`

Before writing the Coach, two things were tested against the real AI service:

**1. Does answering still stream word-by-word if the AI has to look something
up mid-answer?** Yes — 9 separate pieces arrived. An earlier reading suggested
otherwise, but that turned out to be a short answer rather than a limitation.
Worth re-measuring instead of designing around a wrong conclusion.

**2. How slow is "thinking" mode?** Google's model can reason before replying.

| | Time before the first word |
|---|---|
| Thinking on | **7.70 seconds** |
| Thinking off | **0.82 seconds** |

Nine times faster. Chat lives or dies on responsiveness, and the Coach isn't
reasoning hard — the numbers arrive already calculated. **Chat turns thinking
off; the photo pipeline keeps it on**, where accuracy matters more than speed.

## The Coach's backend — `8167531`

**Added:** `api/chat.py` (229), `api/routes/chat.py` (130), a chat database
migration, and three test files.

**Running total: 48 → 67 tests.**

Three ideas here are worth understanding.

**1. The numbers are calculated in the database and handed over.** Every
message includes a summary: today's calories against target, what you ate,
your last 7 days. The AI reads those; it never counts them. AI models are
famously unreliable at adding up long lists.

**2. Its tools physically cannot reach anyone else's data.** The Coach can call
`get_logs(days)` for more detail. That function takes **only a number of
days** — there is no way to specify *whose* logs — and it uses a database
connection already locked to you. The model couldn't ask for someone else's
data if it tried.

> **Designing so a mistake is impossible** beats designing so a mistake is
> caught. There's no check to forget here, because there's no wrong input to
> supply.

**3. Only the last 20 messages are kept.** This sounds like a limitation and
is the opposite. A plain chatbot's memory is whatever fits in its context
window, so your oldest data silently falls out. Here, the durable facts come
from the database every single turn — so the Coach's knowledge of your history
doesn't depend on conversation length at all.

### What the tests said

Writing them exposed one genuinely dangerous piece of arithmetic:

**Averages must divide by the days you logged, not by 7.** If you logged 2 days
out of 7, dividing by 7 makes it look like you ate a third of what you did —
and the Coach would tell you to eat more when you're already over. A test pins
this:

```python
def test_summary_averages_only_days_that_were_logged():
    # two days at 2000 and 3000 → average 2500, not 714
    assert "2500" in text
```

**A second thing the tests forced:** the suite now needed database
credentials just to *start*, because importing any endpoint pulled in
configuration. That's wrong — tests should run anywhere, including on a build
server with no secrets. A small setup file supplies fake values, and **the
whole suite runs offline with no credentials.**

## Testing the seams — `14ee81d`

**Added:** `api/tests/test_chat_route.py` (**6 tests**). **Running total: 73.**

The existing tests checked each piece alone. These check them *plugged
together*, with the AI and database faked — because "each part works" and "the
parts work together" are different claims.

They confirm the real numbers reach the AI, both halves of a conversation are
saved, and — importantly — that **a failed reply saves nothing**, so history
never contains half a sentence attributed to the Coach.

> **My own test had a bug worth knowing about.** Two of them failed at first,
> and the code was fine. In Python, `from chat import stream_reply` copies the
> function into the current file's namespace — so replacing it in the
> *original* file doesn't affect the copy. I was faking a function that was
> never being called, and the real one was quietly running instead.
>
> Here it failed loudly, which was lucky. The same mistake can just as easily
> produce a test that *passes* while checking nothing — and a test that passes
> against code it never ran is worse than no test, because it buys false
> confidence.

## Hunting a slowdown, and being wrong twice — `2a6983a`

The Coach took over 5 seconds to say its first word.

**Wrong diagnosis #1.** I measured a database round trip at ~700ms, assumed
the chat request made six of them, and merged some queries. Barely helped —
because that 700ms measurement opened a brand-new network connection each
time. Real queries, reusing an open connection, took 50–130ms. The queries
were never the problem.

**Wrong diagnosis #2.** Measuring over the network showed 2.1 seconds per
request. That turned out to be a Windows quirk: the name `localhost` resolves
to a newer-style address first, our server only listens on the older style, and
the failed attempt has to time out before retrying. Using `127.0.0.1`
directly, the identical request took **5 milliseconds**. I had spent an hour
measuring my own measuring tool.

**The actual cause**, found by finally timing each step separately: checking
your login token took **1475ms**, and 900ms of that was building the security
machinery for a brand-new database connection — on *every request*.

Two fixes:

- **Verify the token locally.** The login service publishes the public half of
  the key it signs tokens with, so a token can be checked mathematically here
  instead of by asking over the network. Same guarantee, no round trip.
- **Reuse the connection** for a session instead of rebuilding it each time.

**1475ms → 0.5ms**, on every logged-in page in the app.

> **The lesson:** measure before optimising, and suspect your measuring tool
> before your code. Both wrong guesses were plausible, and both would have
> "fixed" the problem by changing nothing.

## Voice — `14c88e4`

**Added:** `api/transcribe.py` (110), `web/app/log/VoiceButton.tsx` (112),
`api/tests/test_transcribe.py` (**9 tests**). **Running total: 85.**

Speak your meal instead of typing it. The insight: what makes dictation feel
good **isn't better hearing, it's a cleanup pass afterwards.**

Two rules keep it safe:

- **Never invent a food that wasn't said** — an invented food is calories you
  never ate. If a word is unclear, leave it out.
- **Never submit automatically.** The transcript fills the text box; you read
  it and press send. A misheard word is caught by a human before it becomes
  data.

It's also primed with the foods you log most, because generic speech
recognition turns "idli" into "it'll".

### How it was tested without anyone speaking

Google also offers a **text-to-speech** model. So a sentence was *generated*
with filler and a self-correction deliberately in it, then fed through the
real transcription:

> **Generated speech:** *"Um, I had two idlis, no wait, three idlis with,
> like, sambar and coconut chutney"*
> **Came back as:** *"I had three idlis with sambar and coconut chutney."*

Filler gone, correction resolved, food words untouched. A real test of the
hardest part, with nobody in the room.

**A bug this found:** given a photo with no food in it, the AI replied with
`fat_name: "no fat detected"` — and the screen dutifully displayed **"Found no
fat detected in your photo."** The field had no way to express *"there isn't
one"*, so the model wrote its explanation into a field meant for a food name.

**Lesson:** if your data has no way to say "none", something will say it badly.

---

# Week 5 — The app learns your body (9 August)

## The adaptive engine — `23f6590`

**Added:** `api/adaptive.py` (181), `api/routes/weights.py` (201),
`0004_adaptive.sql`, `api/tests/test_adaptive.py` (**21 tests**).
**Running total: 106.**

The Week 1 formula is a *population average*. Real metabolism varies by a few
hundred calories around it for reasons no formula can see. After a fortnight
you've produced better evidence: what you ate, and what your weight did.

**Step 1 — smooth the noise.** Daily weight swings pounds on water and salt
alone. An **exponential moving average** blends each reading into a running
average:

```
today's_trend = 0.3 × today's_weight + 0.7 × yesterday's_trend
```

One salty dinner barely moves it. A real trend shows through in about a week.

**Step 2 — work backwards.**

```
your_real_burn = what_you_ate − (weight_change_in_lb × 3500 ÷ days)
```

Ate 2500 a day and *gained*? Then you burnt **less** than 2500. Lost weight?
You burnt more. (A pound of body mass ≈ 3500 calories.)

**Step 3 — don't believe it too early.** The estimate ramps from formula to
measured across weeks 2 to 4, rather than switching over at a threshold. A
simulation with realistic scale noise showed exactly why:

| After | Estimate error |
|---|---|
| 14 days | **351 calories wrong** |
| 21 days | 271 wrong |
| 28 days | **37 wrong** |

Two weeks of data is nearly worthless. Ramping means the early nonsense is
ignored instead of acted on.

### What the tests said

**A test of mine was wrong, and the code was right.** I'd written:

```python
def test_gaining_too_fast_lowers_calories():   # ← wrong premise
```

It seems obvious: gaining too fast, so cut calories. But the person was eating
**3400** against a **2875** target. The surplus explains the gain. Measured
burn — which *subtracts* that surplus — came out at 2789, **above** the
formula's 2625 guess. So 2875 was too low for their goal all along, and the
target should go **up**.

To make the target fall, they'd have to eat *at* target and still gain fast.
Both cases are now tests. **The code understood the situation better than I
did**, and only writing the check down exposed the gap.

**The guard worth defending most:** no adjustment happens unless **70% of days
were logged.** Your burn is computed from *logged* food, so missing days make
it look like you ate less — and the app would cut calories from someone who
merely forgot to log. That's the worst mistake available to it. It refuses,
and says why.

## The chart — `e9bdba5`

**Added:** the weigh-in page and its chart (75 lines, drawn by hand rather
than with a charting library — it's two lines on a shared scale, and a
dependency would have been more code than the maths).

Raw weigh-ins are drawn faint behind the smoothed trend, because the raw line
is noise and the trend is the thing worth reacting to.

## A safety cap that made things less safe — `531a1f9`

The engine is meant to move your target by **at most 150 calories per week**,
so one strange week can't send it flying.

What was written capped it at 150 calories **per weigh-in** — and ran on every
weigh-in. Weigh weekly and those are identical. Weigh **daily** and you get
seven chances a week: the target could travel over a thousand calories in
seven days. The safety cap was doing precisely the opposite of its job.

**Why 106 passing tests missed it.** Each test asked one question — *"given
this data, what's the answer?"* — and every answer was correct. **The bug
isn't in any single answer.** It only exists across a *sequence*, because each
answer becomes the starting point for the next.

Simulating four weeks against the real database exposed it in one run: **14
target changes in 28 days**, where there should have been about four.

**The fix:** adjust at most weekly, and ignore changes under 25 calories
(those are noise, and a history full of 6-calorie entries buries the changes
that mattered).

**And it got more accurate.** Afterwards it recorded 2 changes instead of 14,
and landed **3 calories from ideal instead of 21**. Reacting less often made
it better, because it stopped chasing noise.

> **Lesson:** "at most X per week" and "at most X per event" are the same rule
> only if events happen exactly once a week. Any rate limit written as a
> per-event limit deserves a second look.

**Running total: 109 tests.**

---

# Week 6 — The app remembers your meals (10 August)

## Meal memory — `f3b2dbb`

**Added:** `api/memory.py` (130), `api/tests/test_memory.py` (**18 tests**),
`0005_meal_memory.sql`, plus the one-tap offer in the review screen.
**Running total: 127.**

The feature the whole project is arguing for. Log a meal; log something
similar later; the app recognises it and offers **your own corrected numbers**
in one tap. Accuracy improves with use instead of staying flat.

> **What's an "embedding"?**
> A way of turning text into a list of numbers that captures what it *means*
> rather than how it's spelled. Things with similar meanings get similar
> numbers.
>
> Think of it as coordinates on a map, except with 768 axes instead of two.
> "2 idlis with sambar" and "idli x2, sambar" land almost on top of each
> other; "chicken caesar salad" lands far away. "Similar meaning" becomes
> "short distance", which is now just arithmetic.

> **What's "pgvector"?**
> An add-on that teaches our existing database to store those number-lists and
> search them by distance. There are separate products that only do this, but
> keeping it in the database we already have means one less thing to run —
> and, more importantly, **the same per-user lock applies**. A separate
> service would need its own access control invented from scratch.

### What the measurements said, before any code

Three findings, each of which changed the design:

**1. The default output is too big to index.** The model returns **3072**
numbers per meal. pgvector's search indexes stop at 2000, so the obvious
approach couldn't have been indexed at all. The model accepts a request for
fewer, so we ask for **768** — indexable, a quarter the storage, and measured
to work just as well.

**2. Shorter vectors come back the wrong length.** This one would have been
nasty. The full 3072 output is *normalised* — scaled so its length is exactly
1, which the comparison maths assumes. At 768, the length came back as
**0.59**.

Nothing would have crashed. Every comparison would just have been quietly
slightly wrong, forever. So we rescale them ourselves.

**3. Does it actually tell meals apart?** Comparing everything to *"2 idlis
with sambar and coconut chutney"*:

| Score | Meal | Should match? |
|---|---|---|
| 0.9481 | "two steamed idlis served with sambar and fresh coconut chutney" | yes |
| 0.9426 | "idli x2, sambar, coconut chutney" | yes |
| 0.9245 | "3 idlis with sambar and chutney" | yes — same meal, different count |
| **0.8299** | **"masala dosa with sambar and coconut chutney"** | **no** |
| 0.5798 | "chicken biryani with raita" | no |
| 0.4618 | "grilled chicken caesar salad" | no |

**The dosa row set the threshold.** It shares two of three components — same
sambar, same chutney — but a completely different main course. Offering it as
"your usual" would put the wrong dish in someone's log. The cutoff is **0.90**,
which clears it with room on both sides.

The tests pin those exact measured numbers, so if anyone later nudges the
threshold, the dosa case fails and explains why it exists.

### Two deliberate refusals

**A match is offered, never applied.** The app shows *"You've logged this
before"* and a button. It never silently swaps in old numbers — that would be
precisely the confident wrongness this whole project is designed against.

**A failed embedding never blocks a log.** If the AI service is down, the meal
still saves and simply has no memory entry. Losing real data because an
optional convenience broke would be a straight downgrade.

### A slot that had been empty since Phase 1

The vision prompt has always had a `{{known_meals}}` placeholder, filled with
the text "(none yet)" because there was no meal history to put in it. It now
carries the user's recent meals — so the model is told what this person
actually eats before it looks at the photo. That's the difference between
reading an image as "dosa" and as "crepe".

---

# Every bug, and what it taught

In order. The striking pattern: **almost none would have been caught by the
computer checking the code for obvious errors, and several passed the tests.**

| # | What went wrong | Why | How it was found |
|---|---|---|---|
| 1 | Training days never saved | Field not declared, so it was silently discarded | Looking in the database after using the form |
| 2 | Two calorie tests wrong | My arithmetic, not the code's | TDD — failed for the wrong reason |
| 3 | Server wouldn't start | Settings read before they were loaded | Running it |
| 4 | Test runner crashed | It tried to run a demo script as a test | Running the tests |
| 5 | "File not found" | Path relative to where you ran it, not where it lives | Running from another folder |
| 6 | "CORS error" | An unhandled crash, not CORS | Clicking through in a browser |
| 7 | Stale numbers after re-login | Two overlapping requests, older one landing last | Clicking quickly on purpose |
| 8 | **Bananas logged at 4× calories** | Database ranked "dehydrated" above "raw" | First real photo through the pipeline |
| 9 | Question didn't match its buttons | AI wrote the question, code wrote the answers | Reading real output |
| 10 | "CORS error" again | AI service overloaded, unhandled | Browser testing |
| 11 | "Found no fat detected in your photo" | No way for the data to say "none" | Browser testing |
| 12 | Added foods had no carbs or fat | Search only returned two of four numbers | Re-reading the code |
| 13 | Image previews leaked memory | Cleanup captured an empty list; a warning was silenced | Re-reading the code |
| 14 | Front page was a debug screen | Never replaced | Re-reading the code |
| 15 | Login page unstyled | It worked, so nothing forced it | Looking at it |
| 16 | Every page slow by 1.5 seconds | Security machinery rebuilt per request | Timing each step, after two wrong guesses |
| 17 | **Target could move 1050 cal/week** | Limit written per-event instead of per-week | Simulating four weeks |

### The four themes

1. **Silent failures are the expensive ones.** #1, #12 and #13 all *worked* as
   far as anyone could tell. Nothing crashed. Data was just quietly wrong.
2. **The error message often names the symptom, not the disease.** Three
   separate "CORS errors" had nothing to do with CORS.
3. **Tests check the cases you thought of.** #17 survived 106 passing tests
   because every test asked one question and the bug lived between questions.
4. **Measure before you fix.** #16 took three attempts, two of which were
   confident and wrong.

### Three times the test was wrong and the code was right

Worth separating out, because it's the opposite of what people expect tests to
do. A failing test means *something* disagrees — it does **not** tell you which
side is mistaken. Three times here, the code was fine and my check was faulty.

**Week 1 — bad arithmetic in the expected answer.** I asserted a calorie target
calculated from resting metabolism, when it should have been resting metabolism
× activity factor. The code had it right. *Caught because TDD made the
disagreement appear immediately, while both sides were still fresh enough to
compare.*

**Week 4 — a fake that replaced nothing.** Two tests failed, and it took a
while to accept the application code was innocent. In Python,
`from chat import stream_reply` **copies** the function into the importing
file, so substituting it in the original leaves the copy untouched. I was
faking a function nobody called, while the real one quietly ran and tried to
reach the network. *Caught because the tests took 13 seconds — the giveaway
that something was hitting the internet.*

**Week 5 — a premise that felt obvious and wasn't.** I wrote
`test_gaining_too_fast_lowers_calories`. Gaining too fast, so cut calories:
obvious. Also wrong. The person was eating 3400 against a 2875 target, so the
surplus explains the gain, and measured burn — which subtracts that surplus —
came out *above* the formula's estimate. The target should rise. *Caught
because the code disagreed with me and turned out to have the better grasp of
the physics.*

**What to take from it:** when a test fails, the first question is "which of
these two is wrong?" — not "how do I make this pass?". Changing the test until
it goes green is how a real bug gets certified as correct behaviour.

---

# Where things stand

| | |
|---|---|
| Phase | 3 of 5 |
| Tests | **127**, all offline, ~4 seconds |
| API endpoints | 14 |
| Database tables | 9, every one with Row Level Security |
| Deployed | **No** — runs on one laptop |

**Works:** signup and login · onboarding with personalised targets ·
photo/text/voice meal logging with USDA-grounded numbers · bounded questions
about hidden cooking oil · full editing before saving · a dashboard of today
against target · a Coach that answers from real logged data · adaptive targets
learned from your own weigh-ins.

**Not built yet:** the recipe corpus · the Foodie assistant · an accuracy
evaluation suite · deployment.

### Known limitations, stated plainly

- **Portion estimates from a photo are ±20–30%.** No engineering fixes that.
  The app leans on trends and easy editing instead of claiming precision.
- **USDA doesn't have every food.** No *poha*, so it matches a groundcherry
  entry sharing the word — and the calorie sanity check can't catch that one,
  because the wrong answer is calorically plausible.
- **Both free services have hard limits.** The AI's daily allowance ran out
  twice during single sessions of testing. The database pauses after about a
  week idle, which turns a shared link into a dead one.
- **The Coach's medical guardrail is an instruction, not a rule in code.**
  Weaker than the alternative, and worth saying rather than glossing.
- **Nothing checks that a page *looks* right.** Every visual bug here was
  found by a person looking at a screenshot.
