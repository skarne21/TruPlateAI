# How TruPlate runs in the cloud

Written to be understood, not skimmed. If you can explain the diagram on the
next page and answer "why not just one server?", you can defend this in an
interview.

---

## 1. The app is three programs, not one

This is the thing most people get wrong when they first deploy something. "The
app" is not one thing you put on one computer.

| Piece | What it actually is | What it needs |
|---|---|---|
| **Next.js front end** | Files: HTML, CSS, JavaScript, images | To be *copied* near the user |
| **FastAPI back end** | A Python process that has to be awake and thinking | A computer to *run on* |
| **Supabase** | Postgres, auth, and file storage | Nothing — already hosted |

Files and processes have completely different needs, so they are hosted
differently. A file can be copied to fifty machines around the world and served
from whichever is nearest — that is a CDN, and it is nearly free because
copying a file is cheap. A *process* cannot be handled that way: it holds
memory, opens database connections, and keeps API keys. Exactly one thing has
to run it, and that costs money.

**Interview line:** *"The front end is static assets, so it goes on a CDN. The
back end is a stateful process holding secrets, so it runs in a container. They
have different hosting requirements, so I host them separately."*

---

## 2. What Google Cloud actually is

Not one product. It is roughly forty separate services that you switch on
individually, inside a container called a **project**.

A **project** is the boundary for three things: what is switched on, who can
touch it, and who gets the bill. Everything below lives inside one project.

This app uses five services:

| Service | Its one job | Plain-English analogy |
|---|---|---|
| **Cloud Build** | Turns your code into an image | The factory |
| **Artifact Registry** | Stores that image | The warehouse |
| **Cloud Run** | Runs the image when requests arrive | The kitchen that opens when someone orders |
| **Secret Manager** | Holds the API keys | The safe |
| **Cloud Scheduler** | Calls a URL on a timetable | The alarm clock |

You do not need to know the other thirty-five.

---

## 3. What a container is, and why it exists

A **container** is your code plus the exact operating system, exact Python
version, and exact libraries it needs, packaged into one file called an
**image**.

It exists to kill one specific sentence: *"it works on my machine."*

Your laptop is Windows with Python 3.13.14 and fifty-odd installed packages.
A cloud server is Linux with whatever it happens to have. Rather than hoping
those match, you ship the environment along with the code. `api/Dockerfile` is
the recipe for building it, and it is short enough to read in a minute.

Two details in that file are worth understanding, because both are things
interviewers ask about:

**Why dependencies are copied before the source.** Docker builds in layers and
reuses any layer whose inputs have not changed. `requirements.txt` changes
rarely; your code changes constantly. Installing dependencies *first* means
editing a route rebuilds only the last layer — seconds, not a full reinstall of
fifty packages. Reverse the two lines and every one-character change costs a
full install.

**Why the port is not hardcoded.** Cloud Run chooses a port and passes it in as
`$PORT`. Hardcode 8000 and the platform's health check knocks on a door nobody
is behind, and the deploy fails with logs that look fine.

---

## 4. Cloud Run, and the idea that makes it cheap

Cloud Run's model: **you give it a container, it runs copies of that container
only while requests are arriving.**

When nobody is using TruPlate — which is most of the day, since you open it at
mealtimes — Cloud Run runs **zero** copies, and zero copies cost zero. When a
request arrives it starts one, in a couple of seconds. That is called
**scale to zero**, and it is why a personal app can cost close to nothing.

The price you pay is the **cold start**: the first request after an idle
period waits for the container to boot, Python to start, and the imports to
load. Warm requests are unaffected.

That trade-off is exactly why this project rejected the obvious free option:

| | Idle behaviour | First request after idle |
|---|---|---|
| Render free tier | stops the process | **30–60 seconds** |
| **Cloud Run** | scales to zero | **~2–5 seconds** |

TruPlate is opened a handful of times a day, hours apart. On Render's free
tier, *nearly every meal you log* would hit a minute-long wait — which
destroys the app's whole premise that logging has to be faster than not
logging. A 2–5 second wake is a pause. A 60 second wake is a habit-killer.

**Interview line:** *"I chose Cloud Run because the usage pattern is a few
bursts a day. Scale-to-zero means I pay nothing between meals, and the cold
start is short enough not to break the interaction. The free alternative had a
60-second cold start, which would have undermined the product."*

---

## 5. Secrets: the part that actually matters

TruPlate holds keys that cost real money if leaked — Gemini, USDA, and the
Supabase service key, which bypasses every security rule in the database.

**The rule: secrets are never inside the image.**

A Docker image is a stack of layers, and layers are permanent. Copy a `.env`
file in at step 3 and delete it at step 9, and it is *still there* in layer 3
for anyone who pulls the image. That is why `api/.dockerignore` excludes
`.env` — so `COPY . .` cannot sweep it in by accident.

Instead the keys live in **Secret Manager**, and Cloud Run injects them as
environment variables when the container starts. The code does not change:
`os.environ["GEMINI_API_KEY"]` works identically. Locally the value comes from
your `.env` file; in the cloud it comes from the safe.

This is the deployment half of CLAUDE.md's invariant #2 — *all secret-bearing
calls happen in FastAPI*. The front end never receives a key because there is
no key in the front end to receive.

**The exception worth being able to explain.** The browser *does* hold
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and that is fine by design. The anon key is
useless on its own: every table has **Row Level Security**, so the database
returns only rows belonging to whoever is logged in. The key identifies the
project; the user's login token determines what they may see. The Gemini key
has no equivalent protection — anyone holding it can spend your quota — which
is why it never leaves the server.

---

## 6. Where Supabase fits

You are not deploying a database. That is the point of Supabase: Postgres,
authentication, and file storage already run somewhere, and you get a URL and
two keys.

The consequence is that **the browser talks to two back ends**:

```
                    ┌─────────────────────────────────┐
   Browser ────────►│ Supabase directly               │
   (Vercel-served)  │  · login / session tokens       │
        │           │  · meal photo upload to Storage │
        │           └─────────────────────────────────┘
        │                        ▲
        │  every request carries │ same database
        │  the session token     │
        ▼                        │
   ┌─────────────────────────────┴───┐
   │ FastAPI on Cloud Run            │
   │  · verifies the token           │
   │  · calls Gemini    (secret)     │
   │  · calls USDA      (secret)     │
   │  · reads/writes Postgres        │
   └─────────────────────────────────┘
```

Photos go **straight from the browser to Supabase Storage**, not through
FastAPI. There is no secret involved — the bucket's security policy already
restricts writes to the user's own folder — so routing a multi-megabyte upload
through the API would add cost and latency and protect nothing.

Everything involving a key goes through FastAPI. That split *is* the
architecture.

---

## 7. One request, end to end

You photograph lunch and hit Analyze:

1. The browser has the page already — Vercel served it from a nearby CDN node.
2. The photo uploads directly to **Supabase Storage**.
3. The browser calls **Cloud Run**, attaching the Supabase session token.
4. Cloud Run is asleep. It starts a container (~2–5s), injecting the secrets
   from **Secret Manager**.
5. FastAPI verifies the token's signature locally, using Supabase's published
   public key — no network call, ~2ms instead of ~100ms.
6. It calls **Gemini** to identify the foods, then **USDA** for real macros.
7. It writes the meal to **Postgres**, scoped to your user id.
8. The reply goes back. The container stays warm for a few minutes in case you
   send another, then shuts down and stops costing anything.

---

## 8. The keep-alive, and the bug that was nearly shipped

Supabase pauses a free project after about a week with no **database**
activity. A paused project is a dead app.

The fix is **Cloud Scheduler** calling a URL every few days. The obvious target
is the health endpoint — and it would not have worked:

```python
@app.get("/health")
def health():
    return {"ok": True}          # never touches the database
```

That answers instantly without querying anything. Pointing the keep-alive at it
would have kept the *API* warm while the *database* slept underneath — and
every check would have passed, green, right up until the app was dead.

So there is a second endpoint, `/health/db`, that runs a real query. It reads
one row from the shared recipe corpus: no user data, nothing to leak, and it
proves the round trip happened. Three tests hold it in place, including one
asserting that plain `/health` does **not** touch the database — so the two can
never quietly converge back into the same thing.

**Interview line:** *"The subtlety is that the thing you're keeping alive has
to be the thing that sleeps. My first instinct was to ping the health endpoint,
but that never touches Postgres, so it would have kept the wrong component warm
and failed silently."*

---

## 9. Deploying it

`api/deploy.ps1` does all of this in one command and is safe to re-run:

```powershell
gcloud auth login          # your browser, your Google account
.\deploy.ps1 -ProjectId truplate-ai -WebOrigin https://truplate.vercel.app
```

It reads the keys from `api/.env` rather than taking them as arguments, so
they never land in PowerShell history or terminal scrollback.

The rest of this section is what that script actually does, step by step,
so you can explain it rather than only run it. From `api/`:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Switch on the services this uses (once per project).
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com

# Put each key in the safe (once each, then never again).
printf '%s' "YOUR_GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
printf '%s' "YOUR_USDA_KEY"   | gcloud secrets create USDA_API_KEY   --data-file=-
printf '%s' "YOUR_SERVICE_KEY" | gcloud secrets create SUPABASE_SERVICE_KEY --data-file=-

# Build and deploy in one step. --source builds with Cloud Build in the cloud,
# so local Docker is not required.
gcloud run deploy truplate-api \
    --source . \
    --region us-central1 \
    --allow-unauthenticated \
    --set-env-vars "SUPABASE_URL=...,SUPABASE_ANON_KEY=...,WEB_ORIGINS=https://your-app.vercel.app" \
    --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,USDA_API_KEY=USDA_API_KEY:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest"
```

`--allow-unauthenticated` means *Google* does not demand credentials at the
door. It does **not** mean the API is open: every route still verifies a
Supabase session token. Without this flag, only Google accounts could reach it
and your users could not.

Then the keep-alive:

```bash
gcloud scheduler jobs create http truplate-keepalive \
    --schedule "0 9 */3 * *" \
    --uri "https://YOUR-SERVICE-URL/health/db" \
    --http-method GET \
    --location us-central1
```

And the front end, from `web/`:

```bash
npx vercel --prod
```

Set `NEXT_PUBLIC_API_URL` to the Cloud Run URL in Vercel's dashboard, then set
`WEB_ORIGINS` on Cloud Run to the Vercel URL. They have to point at each other,
and this is the step people forget.

---

## 10. Things to be able to say out loud

- **Why two hosts?** Static assets and a stateful process have different needs.
  A CDN cannot run Python; a container is a waste of money for serving files.
- **Why containers?** So the environment ships with the code and "works on my
  machine" stops being a category of bug.
- **Why scale-to-zero?** The usage pattern is a few bursts a day. Paying for an
  idle server 23 hours a day makes no sense at this size.
- **What is the cold-start trade-off?** ~2–5s on the first request after idle.
  Acceptable here; the 60s free-tier alternative was not.
- **How are secrets handled?** Never in the image — layers are permanent.
  Injected at runtime from Secret Manager. The only browser-visible key is the
  Supabase anon key, which is safe because Row Level Security means it grants
  nothing on its own.
- **What is the riskiest part?** Free-tier limits, not the code. Supabase
  pauses when idle and the Gemini quota is finite — both have bitten this
  project during development.
