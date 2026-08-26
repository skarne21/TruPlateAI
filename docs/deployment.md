# How TruPlate Runs in the Cloud

> **The one-sentence version:** the front end is *files* served from a CDN, the
> back end is a *process* running in a container that sleeps when nobody's
> eating, and the database was never ours to host in the first place.

If you can explain that sentence and the diagram in [§2.4](#24-the-whole-picture),
you can defend this architecture in an interview.

---

## Contents

| Part | What it covers |
|---|---|
| [1. Live system](#1-the-live-system) | URLs, what's running, measured numbers |
| [2. The mental model](#2-the-mental-model) | Why three hosts, what a container is, the full picture |
| [3. Cloud Run](#3-cloud-run-and-why-its-nearly-free) | Scale-to-zero, cold starts, the trade-off |
| [4. Secrets](#4-secrets-the-part-that-actually-matters) | Why keys never touch the image |
| [5. Keeping it alive](#5-keeping-the-database-awake) | The bug that nearly shipped |
| [6. Deploying](#6-deploying) | Commands, migrations, checklist |
| [7. Troubleshooting](#7-when-it-breaks) | Symptoms → causes |
| [8. Interview answers](#8-answers-worth-having-ready) | Say-out-loud versions |

---

## 1. The live system

### What's running

| Piece | Where | URL |
|---|---|---|
| **Front end** | Vercel (Hobby, free) | https://truplate.vercel.app |
| **API** | Google Cloud Run | https://truplate-api-vk77gjxc4q-uc.a.run.app |
| **Database, auth, file storage** | Supabase (free tier) | — |

### Google Cloud details

| | |
|---|---|
| Project | `gen-lang-client-0297556778` — named "TruPlate" |
| Region | `us-central1` |
| Service | `truplate-api` |
| Keep-alive job | `truplate-keepalive` — every 3 days, 09:00 UTC |

The API deliberately shares a project with the Gemini API key instead of getting
its own. One project means **one place to read quotas and one bill**, and the
key was already issued there.

### Measured against the live service

Not "should work" — actually checked after deploying:

| Check | Result |
|---|---|
| Warm response | **160–205 ms** |
| `/health/db` (real Postgres round trip) | 587 ms |
| Request with no token | **401** |
| Request with an invalid token | **401** |
| Browser preflight from `truplate.vercel.app` | allowed |
| Browser preflight from `evil.example.com` | **refused** |
| Scheduler → `/health/db` | **200**, confirmed in logs |
| Full signup → scan → log → history, **in production** | passes |

> ⚠️ **The two worth repeating after every deploy** are the last preflight pair.
> Together they prove the origin allowlist is *discriminating*, not merely
> present. A misconfigured list often allows everything, which looks identical
> to working until someone else's site starts calling your API.

---

## 2. The mental model

### 2.1 The app is three programs, not one

This is the thing most people get wrong on their first deploy. "The app" is not
one thing you put on one computer.

| Piece | What it actually is | What it needs |
|---|---|---|
| **Next.js front end** | Files — HTML, CSS, JS, images | To be **copied** near the user |
| **FastAPI back end** | A Python process that must be awake and thinking | A computer to **run on** |
| **Supabase** | Postgres + auth + file storage | Nothing — already hosted |

Files and processes have genuinely different needs:

- A **file** can be copied to fifty machines worldwide and served from whichever
  is nearest. That's a CDN, and it's nearly free, because copying a file is cheap.
- A **process** can't work that way. It holds memory, opens database
  connections, and keeps API keys. Exactly one thing has to run it — and that
  costs money.

That single distinction is why the two halves are hosted differently.

### 2.2 What Google Cloud actually is

Not one product. Roughly **forty separate services you switch on individually**,
inside a container called a **project**.

> A **project** is the boundary for three things: what's switched on, who can
> touch it, and who gets the bill.

This app uses five:

| Service | Its one job | Think of it as |
|---|---|---|
| **Cloud Build** | Turns your code into an image | The factory |
| **Artifact Registry** | Stores that image | The warehouse |
| **Cloud Run** | Runs the image when requests arrive | A kitchen that opens when someone orders |
| **Secret Manager** | Holds the API keys | The safe |
| **Cloud Scheduler** | Calls a URL on a timetable | The alarm clock |

You can ignore the other thirty-five.

### 2.3 What a container is

A **container** is your code *plus* the exact operating system, Python version,
and libraries it needs, packaged into one file called an **image**.

It exists to eliminate one sentence: *"it works on my machine."*

Your laptop is Windows with Python 3.13.14 and fifty-odd packages. A cloud
server is Linux with whatever it happens to have. Rather than hoping those
match, you **ship the environment along with the code**.

Three decisions in [`api/Dockerfile`](../api/Dockerfile) are worth understanding,
because all three are things interviewers ask about:

**① Dependencies are copied before the source.**
Docker builds in layers and reuses any layer whose inputs haven't changed.
`requirements.txt` changes rarely; your code changes constantly. In this order,
editing a route rebuilds seconds' worth of work. Reverse the two lines and every
one-character change reinstalls fifty packages.

**② The port isn't hardcoded.**
Cloud Run picks a port and passes it in as `$PORT`. Hardcode `8000` and the
platform's health check knocks on a door nobody's behind — the deploy fails with
logs that look completely fine.

**③ `CMD` uses `exec`.**
Without it, the shell stays as process 1 and swallows the shutdown signal.
Uvicorn never hears `SIGTERM`, so every scale-down waits for the kill timeout
instead of closing cleanly.

### 2.4 The whole picture

The consequence of using Supabase is that **the browser talks to two back ends**:

```
                            ┌────────────────────────────────┐
   Browser  ───────────────►│  Supabase (directly)           │
   (served by Vercel)       │   · login / session tokens     │
        │                   │   · meal photo upload          │
        │                   └────────────────────────────────┘
        │                                  ▲
        │  every request carries           │  same database
        │  the Supabase session token      │
        ▼                                  │
   ┌───────────────────────────────────────┴──┐
   │  FastAPI on Cloud Run                    │
   │   · verifies the token (locally, ~2ms)   │
   │   · calls Gemini          ← secret       │
   │   · calls USDA            ← secret       │
   │   · reads/writes Postgres ← secret       │
   └──────────────────────────────────────────┘
```

Photos go **straight from the browser to Supabase Storage**, not through
FastAPI. No secret is involved — the bucket's security policy already restricts
writes to your own folder — so routing a multi-megabyte upload through the API
would add cost and latency while protecting nothing.

Everything involving a key goes through FastAPI. **That split is the
architecture.**

### 2.5 One request, end to end

You photograph lunch and press Analyze:

1. The browser already has the page — Vercel served it from a nearby CDN node.
2. The photo uploads **directly to Supabase Storage**.
3. The browser calls **Cloud Run**, attaching the Supabase session token.
4. Cloud Run is asleep, so it starts a container (~2–5s), injecting secrets from
   **Secret Manager**.
5. FastAPI verifies the token's signature **locally** against Supabase's
   published public key — no network call, ~2ms instead of ~100ms.
6. It calls **Gemini** to identify foods, then **USDA** for real macros.
7. It writes the meal to **Postgres**, scoped to your user id.
8. The reply returns. The container stays warm a few minutes in case you send
   another, then shuts down and stops costing anything.

---

## 3. Cloud Run, and why it's nearly free

The model: **you hand it a container, and it runs copies only while requests are
arriving.**

When nobody's using TruPlate — most of the day, since you open it at mealtimes —
Cloud Run runs **zero copies**, and zero copies cost zero. When a request
arrives, it starts one. That's **scale to zero**.

The price is the **cold start**: the first request after an idle period waits
for the container to boot, Python to start, and imports to load. Warm requests
are unaffected.

That trade-off is exactly why this project rejected the obvious free option:

| Host | When idle | First request after idle | Cost |
|---|---|---|---|
| Render (free) | stops the process | **30–60 seconds** | $0 |
| **Cloud Run** | scales to zero | **~2–5 seconds** | ~$0 at this size |

TruPlate is opened a handful of times a day, hours apart. On Render's free tier,
**nearly every meal you log** would hit a minute-long wait — destroying the
app's whole premise that logging must be faster than *not* logging.

> A 2–5 second wake is a pause. A 60 second wake is a habit-killer.

### What it actually costs

Everything here sits inside always-free tiers:

| Service | Free allowance | Actual usage |
|---|---|---|
| Cloud Run | 2M requests/month | a few hundred |
| Cloud Build | 120 build-min/day | ~3 min per deploy |
| Secret Manager | 6 active versions | 3 |
| Cloud Scheduler | 3 jobs | 1 |
| Artifact Registry | 0.5 GB | 285 MB per image |
| Vercel Hobby | personal projects | 1 |

Realistically **$0/month** for infrastructure. Real spend stays what it already
was: Gemini API calls.

> ⚠️ **The one thing that creeps.** Every deploy pushes a new 285 MB image and
> old ones aren't deleted. Two or three deploys and you're over Artifact
> Registry's 0.5 GB free tier. Pennies — but it grows quietly forever, so it
> wants a cleanup policy.

---

## 4. Secrets: the part that actually matters

TruPlate holds keys that cost real money if leaked — Gemini, USDA, and the
Supabase **service key**, which bypasses every security rule in the database.

> ### The rule: secrets are never inside the image.

A Docker image is a stack of layers, and **layers are permanent**. Copy a `.env`
in at step 3 and delete it at step 9, and it is *still there* in layer 3 for
anyone who pulls the image. That's why [`api/.dockerignore`](../api/.dockerignore)
excludes `.env` — so `COPY . .` can't sweep it in by accident.

Instead the keys live in **Secret Manager**, and Cloud Run injects them as
environment variables at container start. **The code doesn't change:**
`os.environ["GEMINI_API_KEY"]` works identically. Locally the value comes from
your `.env`; in the cloud it comes from the safe.

Verified rather than assumed — the live service shows:

```
GEMINI_API_KEY        → secretKeyRef        (never an inline value)
USDA_API_KEY          → secretKeyRef
SUPABASE_SERVICE_KEY  → secretKeyRef
SUPABASE_URL          → plain value         (public anyway)
SUPABASE_ANON_KEY     → plain value         (public by design — see below)
```

### The exception worth being able to explain

The browser **does** hold `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and that's correct by
design:

- The anon key is **useless on its own**. Every table has **Row Level Security**,
  so the database returns only rows belonging to whoever is logged in.
- The key says *which project*. The user's login token says *what they may see*.
- The Gemini key has **no equivalent protection** — anyone holding it can spend
  your quota. So it never leaves the server.

Vercel enforces this distinction for you. It **refuses** to store a
`NEXT_PUBLIC_*` variable as a secret:

```
Environment variables with a public framework prefix (NEXT_PUBLIC)
cannot use secret visibility on Production or Preview
```

Anything prefixed `NEXT_PUBLIC_` is **inlined into the JavaScript bundle** and
shipped to every visitor. Marking it "secret" would be a lie, and the platform
won't help you tell it. If `GEMINI_API_KEY` had ever been named
`NEXT_PUBLIC_GEMINI_API_KEY`, it would have been published to every visitor —
this refusal is the guardrail against exactly that.

---

## 5. Keeping the database awake

Supabase pauses a free project after roughly a week without **database**
activity. A paused project is a dead app.

The fix is Cloud Scheduler calling a URL every three days. The obvious target
was the health endpoint — and it would have silently failed:

```python
@app.get("/health")
def health():
    return {"ok": True}          # never touches the database
```

That answers instantly without querying anything. A keep-alive aimed at it would
have kept the **API** warm while the **database** slept underneath — and every
check would have passed, green, right up until the app was dead.

So [`/health/db`](../api/main.py) runs a real query: one row from the shared
recipe corpus. No user data, nothing to leak, and it proves the round trip
happened. **Three tests hold it in place**, including one asserting that plain
`/health` does *not* touch the database — so the two can never quietly converge
back into the same thing.

> **The generalisable lesson:** the thing you keep alive has to be the thing
> that sleeps.

### A second trap: enabling a service isn't instant

Worth knowing, because it looks exactly like a bug.

The scheduler job was created immediately after switching the Cloud Scheduler
API on. It reported success, showed as `ENABLED`, had the right URL and
schedule — **and did nothing**. Forced runs returned exit code 0 while no
request ever arrived, and `lastAttemptTime` stayed empty.

Nothing was wrong with it. **Enabling a Google Cloud service takes a few minutes
to propagate**, and until it has, the job accepts commands and silently drops
them. The same forced run minutes later worked, and the logs then showed both
attempts arriving at once.

> **The habit that catches this:** verify a scheduled job by *forcing a run and
> reading the logs*. A job that was created is not a job that fires.

---

## 6. Deploying

### The short version

```powershell
# API  (from api/)
.\deploy.ps1 -ProjectId gen-lang-client-0297556778 -WebOrigin https://truplate.vercel.app

# Front end  (from web/)
npx vercel deploy --prod
```

Both are safe to re-run. Secrets get a new version rather than erroring, and a
deploy replaces the previous revision.

### First-time setup

Two steps need a browser and can't be scripted:

```powershell
gcloud auth login                      # your Google account
npx vercel login                       # your Vercel account
```

Plus a Google Cloud project with **billing enabled** — Cloud Run refuses to turn
on without it, even though usage here lands inside the free tier.

### What `deploy.ps1` does

1. Enables the four Google Cloud services *(no-op if already on)*
2. Reads keys from `api/.env` — never from the command line, so they don't land
   in PowerShell history
3. Stores each in Secret Manager as a new version
4. **Grants Cloud Run's service account permission to read them** — not granted
   by default; skip it and the deploy succeeds while the container crashes on
   startup unable to read its own config
5. Builds with Cloud Build and deploys
6. Calls both health endpoints so a broken deploy announces itself

### The circular step everyone forgets

The two halves must point at each other, so it takes two passes:

```
1. Deploy API          → get the Cloud Run URL
2. Set NEXT_PUBLIC_API_URL in Vercel to that URL, deploy front end
                       → get the Vercel URL
3. Re-run deploy.ps1 with -WebOrigin set to the Vercel URL   ← easy to skip
```

Skip step 3 and Cloud Run rejects every browser request, which your browser
reports as a CORS error that has nothing to do with CORS.

### Database migrations

Migrations are **not** automated — run them by hand in the Supabase SQL editor,
in order, from [`supabase/migrations/`](../supabase/migrations/):

| # | What it does |
|---|---|
| `0001`–`0007` | Profiles, meals, chat, adaptive targets, meal memory, recipes, saved foods |
| `0008` | Recipe macros stored **per serving**, not per pot |
| `0009` | Allows `barcode` as an item source and input mode |

> ⚠️ A deploy that expects a migration you haven't run fails at the moment of
> *writing*, not on startup — so the app looks fine until you try to save.

---

## 7. When it breaks

| Symptom | Almost always means |
|---|---|
| Browser shows a **CORS error** | `WEB_ORIGINS` doesn't list the front end's real URL. Re-run `deploy.ps1` with the right `-WebOrigin`. |
| Container **deploys then crashes** | The service account can't read a secret. Check the IAM grant step's output. |
| Gemini returns **401** with a key that looks right | A trailing newline got saved into the secret. `Set-Content` appends one; `WriteAllText` doesn't. |
| Deploy succeeds, **health check fails** | Read the logs: `gcloud run services logs read truplate-api --region us-central1` |
| Scheduled job does nothing, **exit code 0** | The API was enabled minutes ago and hasn't propagated. Wait, re-run, read the logs. |
| App works, but **saving fails** | An unrun migration. |
| `deploy.ps1` dies at the deploy step with **no gcloud output** | A `^` in an argument. `gcloud` is a `.cmd` batch file, and `cmd.exe` treats `^` as its own escape character, so gcloud's `^@^` delimiter syntax is eaten before it arrives. Use `--env-vars-file`. |
| `vercel deploy` **exits 0 but nothing changed** | It can report success without publishing. Confirm with `vercel ls` and `vercel alias ls` — check the alias moved, not just that a deployment exists. |
| First request takes ~3s | Cold start. Working as designed. |

### Useful commands

```powershell
# What's actually deployed right now
gcloud run services describe truplate-api --region us-central1

# Recent requests, with status codes
gcloud logging read 'resource.type=cloud_run_revision' --limit 20 --freshness=1h

# Prove the keep-alive fires
gcloud scheduler jobs run truplate-keepalive --location us-central1
gcloud logging read 'httpRequest.userAgent="Google-Cloud-Scheduler"' --freshness=15m
```

---

## 8. Answers worth having ready

> **"Why two hosts?"**
> Static assets and a stateful process have different requirements. A CDN can't
> run Python; a container is a waste of money for serving files.

> **"Why containers?"**
> So the environment ships with the code and "works on my machine" stops being a
> category of bug.

> **"Why scale-to-zero?"**
> The usage pattern is a few bursts a day. Paying for an idle server 23 hours a
> day makes no sense at this size.

> **"What's the cold-start trade-off?"**
> ~2–5s on the first request after idle. Acceptable here; the free alternative's
> 60s was not, because it would have undermined the product's core promise.

> **"How are secrets handled?"**
> Never in the image — layers are permanent. Injected at runtime from Secret
> Manager. The only browser-visible key is the Supabase anon key, which is safe
> because Row Level Security means it grants nothing on its own.

> **"What's the riskiest part?"**
> Free-tier limits, not the code. Supabase pauses when idle and the Gemini quota
> is finite — both have bitten this project during development.

> **"Tell me about a subtle bug you found."**
> The keep-alive. Supabase pauses on database inactivity, and my first instinct
> was to ping `/health` — which never queries anything. It would have kept the
> API warm while the database slept, with every check passing green until the
> app was dead. The thing you keep alive has to be the thing that sleeps.
