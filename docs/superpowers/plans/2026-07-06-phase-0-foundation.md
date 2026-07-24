# Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TruPlate AI skeleton — Next.js frontend talking to a FastAPI backend over CORS, Supabase auth + `profiles` table with RLS, the onboarding wizard, and the deterministic targets engine — so a new user can sign up, complete the wizard, see their targets, and have it persist across logins.

**Architecture:** Two sibling apps (`web/`, `api/`) in one repo. Next.js calls FastAPI only; FastAPI is the only thing holding secrets (Gemini/USDA keys, Supabase service key) and the only thing that talks to USDA/Gemini. Supabase Postgres is the single source of truth, with Row Level Security as the actual enforcement boundary — the backend authenticates each request as the calling user (not as an all-powerful service role) so a query bug can't leak another user's rows.

**Tech Stack:** Next.js 14+ (App Router, TypeScript, Tailwind), FastAPI + Python 3.11+ (3.13 installed), Supabase (Postgres + email auth, `@supabase/ssr` on the frontend, `supabase-py` on the backend), pytest, vitest.

## Global Constraints

- Frontend: Next.js (App Router) + TypeScript + Tailwind, PWA target — `web/`.
- Backend: FastAPI, Python 3.11+, typed, Pydantic models for all request/response bodies — `api/`.
- DB/auth: Supabase (Postgres + pgvector + email auth).
- Every user-data table has `user_id` and RLS enabled at creation time — no exceptions.
- All AI/USDA/secret-bearing calls happen in FastAPI only; the frontend never sees a raw key.
- Every FastAPI route that touches user data verifies the Supabase JWT; queries are scoped to `auth.uid()` via RLS, not just an application-level `WHERE user_id = ...` filter, so RLS is the real backstop.
- Deterministic math (TDEE, targets) is computed in Python with unit tests — never delegated to an LLM.
- Env vars — `api/.env`: `GEMINI_API_KEY`, `USDA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`. `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`. `.env*` gitignored; `.env.example` documents names only.
- Exit criteria (from `docs/phase-0-checklist.md`): sign up as a new user → complete the wizard → see targets → log out, log back in, data persists → `pytest` passes → repo has a README stub with a one-paragraph description.

**Credentials already available** (root `.env`, to be split into `api/.env` / `web/.env.local` in Task 1): `GEMINI_API_KEY`, `USDA_API_KEY`, `SUPABASE_PROJECT_URL` (→ `SUPABASE_URL`), `SUPABASE_SECRET_KEY` (→ `SUPABASE_SERVICE_KEY`, Supabase's new naming for the service-role key), `SUPABASE_PUBLISHABLE_KEY` (→ `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, new naming for the anon key), `SUPABASE_PASSWORD` (raw DB password — only needed if linking the Supabase CLI directly; the app itself talks over the URL + keys, not this).

**Manual gates** (need Shivaths, not something I can do from here):
- Enable Email auth in Supabase dashboard (Authentication → Providers) if not already on.
- Drop a real meal photo at `api/scripts/test_meal.jpg` before Task 5's Gemini sanity script can be run for real (gitignored already).
- Run the RLS migration SQL from Task 6 in the Supabase SQL editor (or via CLI) — I'll write the exact SQL, but applying it against your project is a one-paste action on your end since I don't have a DB connection from here.

---

### Task 1: Backend scaffold — FastAPI health endpoint + CORS + env split

**Files:**
- Create: `api/main.py`
- Create: `api/requirements.txt`
- Create: `api/.env` (values migrated from root `.env`, renamed to match constraint list)
- Create: `api/.env.example`
- Modify: delete root `.env` once split (secrets now live in `api/.env` / `web/.env.local` only)

**Interfaces:**
- Produces: `GET /health` → `{"ok": true}`, importable FastAPI `app` object in `api/main.py` that Task 7/8 will add routes to.

- [ ] **Step 1: Create the venv and install dependencies**

```bash
mkdir -p api/scripts api/tests
cd api
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install fastapi "uvicorn[standard]" python-dotenv requests google-genai supabase pytest pyjwt
pip freeze > requirements.txt
cd ..
```

- [ ] **Step 2: Write `api/main.py`**

```python
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(title="TruPlate AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}
```

- [ ] **Step 3: Create `api/.env`** by copying values out of the root `.env` under the constraint-list names:

```
GEMINI_API_KEY=<value from root .env>
USDA_API_KEY=<value from root .env>
SUPABASE_URL=<value of SUPABASE_PROJECT_URL from root .env>
SUPABASE_SERVICE_KEY=<value of SUPABASE_SECRET_KEY from root .env>
SUPABASE_ANON_KEY=<value of SUPABASE_PUBLISHABLE_KEY from root .env>
```

- [ ] **Step 4: Create `api/.env.example`**

```
GEMINI_API_KEY=
USDA_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
```

- [ ] **Step 5: Run it and verify**

```bash
cd api && .venv\Scripts\activate && uvicorn main:app --reload
```

Run: `curl http://localhost:8000/health`
Expected: `{"ok":true}`

- [ ] **Step 6: Delete the root `.env`** (now redundant — values live in `api/.env`) and confirm `git status` shows nothing new untracked from secrets.

- [ ] **Step 7: Commit**

```bash
git add api/main.py api/requirements.txt api/.env.example
git commit -m "feat: FastAPI health endpoint with CORS"
```

---

### Task 2: Frontend scaffold — Next.js + health check display

**Files:**
- Create: `web/` (via `create-next-app`)
- Modify: `web/app/page.tsx`
- Create: `web/.env.local`
- Create: `web/.env.local.example`

**Interfaces:**
- Consumes: `GET /health` from Task 1.
- Produces: `web/.env.local` with `NEXT_PUBLIC_API_URL` that Task 9/10 reuse.

- [ ] **Step 1: Scaffold**

```bash
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

- [ ] **Step 2: Create `web/.env.local`**

```
NEXT_PUBLIC_SUPABASE_URL=<value of SUPABASE_PROJECT_URL from root .env>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<value of SUPABASE_PUBLISHABLE_KEY from root .env>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 3: Create `web/.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 4: Replace `web/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then((r) => r.json())
      .then((data) => setStatus(JSON.stringify(data)))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-xl">API health: {status}</p>
    </main>
  );
}
```

- [ ] **Step 5: Run both servers and verify in browser**

```bash
cd api && .venv\Scripts\activate && uvicorn main:app --reload
cd web && npm run dev
```

Open `http://localhost:3000` — expect `API health: {"ok":true}`.

- [ ] **Step 6: Commit**

```bash
git add web/ .gitignore
git commit -m "feat: Next.js scaffold with API health check"
```

---

### Task 3: Targets engine (TDD) — Mifflin-St Jeor + activity + goal adjustment + protein

No external dependencies — pure Python, fully testable offline. Formula source: `docs/project-plan.md` §3.1 (Mifflin-St Jeor TDEE + activity multiplier + goal-rate adjustment, ±500 kcal ≈ 1 lb/week; protein by bodyweight and goal).

**Files:**
- Create: `api/targets.py`
- Test: `api/tests/test_targets.py`

**Interfaces:**
- Produces: `calculate_targets(profile: TargetsInput) -> TargetsResult` — consumed by Task 7's `/profile` endpoint.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_targets.py
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
    assert result.kcal_target == pytest.approx(1780 + 0.5 * 500, abs=1)

def test_lose_goal_subtracts_kcal_per_rate():
    profile = TargetsInput(
        sex="female", weight_kg=60, height_cm=165, age=25,
        activity_level="sedentary", goal="lose", rate_lb_per_week=1.0,
    )
    result = calculate_targets(profile)
    assert result.kcal_target == pytest.approx(1345.25 - 1.0 * 500, abs=1)

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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && .venv\Scripts\activate && pytest tests/test_targets.py -v`
Expected: `FAIL` — `ModuleNotFoundError: No module named 'targets'`

- [ ] **Step 3: Implement `api/targets.py`**

```python
from pydantic import BaseModel, field_validator

ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

# Safe-rate caps: no crash-diet support (project-plan.md §3.1 onboarding presets).
MAX_LOSE_RATE_LB_PER_WEEK = 1.5
MAX_GAIN_RATE_LB_PER_WEEK = 0.5

# Grams of protein per kg bodyweight, by goal. Higher on a cut to preserve
# muscle during a deficit; standard sports-nutrition range is 1.6-2.2 g/kg.
PROTEIN_G_PER_KG = {
    "lose": 2.2,
    "recomp": 2.0,
    "gain": 1.8,
}

KCAL_PER_LB = 500  # ~3500 kcal/lb spread over 7 days ≈ 500 kcal/day


class TargetsInput(BaseModel):
    sex: str
    weight_kg: float
    height_cm: float
    age: int
    activity_level: str
    goal: str
    rate_lb_per_week: float

    @field_validator("rate_lb_per_week")
    @classmethod
    def validate_safe_rate(cls, v, info):
        goal = info.data.get("goal")
        if goal == "lose" and v > MAX_LOSE_RATE_LB_PER_WEEK:
            raise ValueError(f"rate exceeds safe cap of {MAX_LOSE_RATE_LB_PER_WEEK} lb/week")
        if goal == "gain" and v > MAX_GAIN_RATE_LB_PER_WEEK:
            raise ValueError(f"rate exceeds safe cap of {MAX_GAIN_RATE_LB_PER_WEEK} lb/week")
        return v


class TargetsResult(BaseModel):
    bmr: float
    tdee: float
    kcal_target: float
    protein_g: float
    explanation: str


def calculate_targets(profile: TargetsInput) -> TargetsResult:
    if profile.sex == "male":
        bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + 5
    else:
        bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age - 161

    tdee = bmr * ACTIVITY_MULTIPLIERS[profile.activity_level]

    if profile.goal == "gain":
        kcal_target = tdee + profile.rate_lb_per_week * KCAL_PER_LB
    elif profile.goal == "lose":
        kcal_target = tdee - profile.rate_lb_per_week * KCAL_PER_LB
    else:
        kcal_target = tdee

    protein_g = profile.weight_kg * PROTEIN_G_PER_KG[profile.goal]

    explanation = (
        f"Maintenance is about {tdee:.0f} kcal/day; targeting {kcal_target:.0f} kcal "
        f"and {protein_g:.0f}g protein for your {profile.goal} goal."
    )

    return TargetsResult(
        bmr=bmr, tdee=tdee, kcal_target=kcal_target,
        protein_g=protein_g, explanation=explanation,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_targets.py -v`
Expected: all 7 tests `PASS`

- [ ] **Step 5: Commit**

```bash
git add api/targets.py api/tests/test_targets.py
git commit -m "feat: deterministic targets engine (Mifflin-St Jeor + goal adjustment)"
```

---

### Task 4: Gemini + USDA sanity scripts

**Files:**
- Create: `api/scripts/test_gemini.py`
- Create: `api/scripts/test_usda.py`

- [ ] **Step 1: Write `api/scripts/test_gemini.py`**

```python
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
img = client.files.upload(file="test_meal.jpg")
r = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[img, "List the foods in this photo with estimated grams, as JSON."],
)
print(r.text)
```

- [ ] **Step 2: Write `api/scripts/test_usda.py`**

```python
import os
import requests
from dotenv import load_dotenv

load_dotenv()
r = requests.get(
    "https://api.nal.usda.gov/fdc/v1/foods/search",
    params={"api_key": os.environ["USDA_API_KEY"], "query": "idli", "pageSize": 3},
)
for f in r.json()["foods"]:
    print(
        f["description"],
        {n["nutrientName"]: n["value"] for n in f["foodNutrients"] if n["nutrientName"] in ("Energy", "Protein")},
    )
```

- [ ] **Step 3: Run the USDA script now (key already present)**

Run: `cd api && .venv\Scripts\activate && python scripts/test_usda.py`
Expected: prints idli results with Energy/Protein values — confirms `USDA_API_KEY` is valid.

- [ ] **Step 4: Gemini script — MANUAL GATE**

Needs a real photo at `api/scripts/test_meal.jpg` (gitignored). Ask Shivaths to drop one in, then run:
Run: `python scripts/test_gemini.py`
Expected: JSON-ish text listing foods and grams — confirms `GEMINI_API_KEY` and the vision call work end-to-end.

- [ ] **Step 5: Commit**

```bash
git add api/scripts/test_gemini.py api/scripts/test_usda.py
git commit -m "test: Gemini and USDA sanity scripts"
```

---

### Task 5: Supabase schema + RLS — `profiles` table

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`

- [ ] **Step 1: Write the migration**

```sql
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal text not null check (goal in ('lose', 'gain', 'recomp')),
  rate_lb_per_week numeric not null default 0,
  gym_days int not null default 0,
  activity_level text not null check (
    activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')
  ),
  height_cm numeric not null,
  weight_kg numeric not null,
  age int not null,
  sex text not null check (sex in ('male', 'female')),
  cuisines text[] not null default '{}',
  budget_level text,
  exclusions text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);
```

- [ ] **Step 2: MANUAL GATE — apply the migration**

Ask Shivaths to paste this into the Supabase dashboard's SQL Editor and run it (or `supabase db push` if the CLI is linked). Confirm back with: `select * from public.profiles limit 1;` returning zero rows with no error (proves the table + RLS exist).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_profiles.sql
git commit -m "feat: profiles table with RLS policies"
```

---

### Task 6: Backend auth dependency + `/profile` endpoint

RLS is the real enforcement boundary (constraint list), so the backend must query as the calling user, not as the all-powerful service role. It authenticates each request's Supabase JWT via the Auth API, then issues the DB query through a client carrying that same user's token — `auth.uid()` inside Postgres resolves to the real caller, so a missing `WHERE` clause still can't leak another user's row.

**Files:**
- Create: `api/deps.py`
- Modify: `api/main.py`

**Interfaces:**
- Consumes: `TargetsInput`/`calculate_targets` from Task 3.
- Produces: `get_current_user_client(authorization: str) -> tuple[str, Client]` (user_id, RLS-scoped Supabase client) — reused by every future user-data route (Phase 1's `/analyze`, `/log`, etc.).

- [ ] **Step 1: Write `api/deps.py`**

```python
import os
from fastapi import Header, HTTPException
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]


def get_current_user_client(authorization: str = Header(...)) -> tuple[str, Client]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    user_response = client.auth.get_user(token)
    if user_response.user is None:
        raise HTTPException(401, "Invalid or expired token")

    # Carry the user's token into Postgres calls so RLS evaluates auth.uid()
    # as this user, not the anon role.
    client.postgrest.auth(token)
    return user_response.user.id, client
```

- [ ] **Step 2: Add Pydantic request/response models and the route to `api/main.py`**

```python
from fastapi import Depends
from deps import get_current_user_client
from targets import TargetsInput, calculate_targets, TargetsResult


class ProfileIn(TargetsInput):
    cuisines: list[str] = []
    budget_level: str | None = None
    exclusions: list[str] = []


@app.post("/profile", response_model=TargetsResult)
def create_profile(body: ProfileIn, user=Depends(get_current_user_client)):
    user_id, client = user
    result = calculate_targets(body)
    client.table("profiles").upsert({
        "user_id": user_id,
        "goal": body.goal,
        "rate_lb_per_week": body.rate_lb_per_week,
        "gym_days": 0,
        "activity_level": body.activity_level,
        "height_cm": body.height_cm,
        "weight_kg": body.weight_kg,
        "age": body.age,
        "sex": body.sex,
        "cuisines": body.cuisines,
        "budget_level": body.budget_level,
        "exclusions": body.exclusions,
    }).execute()
    return result


@app.get("/profile", response_model=TargetsResult)
def get_profile(user=Depends(get_current_user_client)):
    user_id, client = user
    row = client.table("profiles").select("*").eq("user_id", user_id).single().execute()
    profile = TargetsInput(**row.data)
    return calculate_targets(profile)
```

- [ ] **Step 3: Manual verification** (needs Task 5's table live and a real user JWT — revisit after Task 8 gives us a logged-in browser session to pull a token from)

- [ ] **Step 4: Commit**

```bash
git add api/deps.py api/main.py
git commit -m "feat: JWT-authenticated /profile endpoint scoped by RLS"
```

---

### Task 7: Frontend Supabase auth — signup/login + session middleware

**Files:**
- Create: `web/lib/supabase/client.ts`
- Create: `web/lib/supabase/server.ts`
- Create: `web/middleware.ts`
- Create: `web/app/signup/page.tsx`
- Create: `web/app/login/page.tsx`

- [ ] **Step 1: Install `@supabase/ssr`**

```bash
cd web && npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: `web/lib/supabase/client.ts`**

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: `web/lib/supabase/server.ts`**

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

- [ ] **Step 4: `web/middleware.ts`** (refreshes the session cookie on every request)

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 5: `web/app/signup/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/onboarding");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-80">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 rounded"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="bg-black text-white p-2 rounded">
          Sign up
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: `web/app/login/page.tsx`** (same shape, calls `signInWithPassword` and routes to `/dashboard`)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-80">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 rounded"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="bg-black text-white p-2 rounded">
          Log in
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Verify** — sign up a test account at `/signup`, confirm redirect to `/onboarding` (404 is fine, doesn't exist until Task 8) and that a row appears under Supabase dashboard → Authentication → Users.

- [ ] **Step 8: Commit**

```bash
git add web/lib web/middleware.ts web/app/signup web/app/login web/package.json web/package-lock.json
git commit -m "feat: Supabase email auth (signup, login, session middleware)"
```

---

### Task 8: Onboarding wizard

One question per screen per `docs/project-plan.md` §3.1: goal → rate → gym days/activity → stats/cuisines/exclusions → submit to `/profile` → show targets.

**Files:**
- Create: `web/app/onboarding/page.tsx`
- Create: `web/app/onboarding/steps.ts` (shared state type)

**Interfaces:**
- Consumes: `POST /profile` from Task 6.

- [ ] **Step 1: `web/app/onboarding/steps.ts`**

```typescript
export type OnboardingState = {
  goal: "lose" | "gain" | "recomp";
  rate_lb_per_week: number;
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active";
  height_cm: number;
  weight_kg: number;
  age: number;
  sex: "male" | "female";
  cuisines: string[];
  budget_level: string;
  exclusions: string[];
};

export const initialState: OnboardingState = {
  goal: "recomp",
  rate_lb_per_week: 0,
  activity_level: "sedentary",
  height_cm: 170,
  weight_kg: 70,
  age: 25,
  sex: "male",
  cuisines: [],
  budget_level: "medium",
  exclusions: [],
};
```

- [ ] **Step 2: `web/app/onboarding/page.tsx`** — single-page multi-step form (four `step` states rendered conditionally), on final submit calls the API with the user's access token and shows the returned targets:

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { initialState, OnboardingState } from "./steps";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<OnboardingState>(initialState);
  const [result, setResult] = useState<{ kcal_target: number; protein_g: number; explanation: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Not logged in");
      return;
    }
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      setError(`Save failed: ${res.status}`);
      return;
    }
    setResult(await res.json());
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-2xl">Your targets: {result.kcal_target.toFixed(0)} kcal, {result.protein_g.toFixed(0)}g protein</p>
          <p className="text-sm text-gray-600 mt-2">{result.explanation}</p>
        </div>
      </main>
    );
  }

  const steps = [
    // Step 0: goal
    <div key="goal" className="flex flex-col gap-4">
      <p>What's your goal?</p>
      {(["lose", "gain", "recomp"] as const).map((g) => (
        <button key={g} onClick={() => { setState({ ...state, goal: g }); setStep(1); }} className="border p-2 rounded">
          {g}
        </button>
      ))}
    </div>,
    // Step 1: rate
    <div key="rate" className="flex flex-col gap-4">
      <p>How aggressively?</p>
      {(state.goal === "lose" ? [0.5, 1.0, 1.5] : state.goal === "gain" ? [0.25, 0.5] : [0]).map((r) => (
        <button key={r} onClick={() => { setState({ ...state, rate_lb_per_week: r }); setStep(2); }} className="border p-2 rounded">
          {r} lb/week
        </button>
      ))}
    </div>,
    // Step 2: activity
    <div key="activity" className="flex flex-col gap-4">
      <p>Activity level?</p>
      {(["sedentary", "light", "moderate", "active", "very_active"] as const).map((a) => (
        <button key={a} onClick={() => { setState({ ...state, activity_level: a }); setStep(3); }} className="border p-2 rounded">
          {a}
        </button>
      ))}
    </div>,
    // Step 3: stats
    <div key="stats" className="flex flex-col gap-4 w-80">
      <input type="number" placeholder="Height (cm)" value={state.height_cm}
        onChange={(e) => setState({ ...state, height_cm: Number(e.target.value) })} className="border p-2 rounded" />
      <input type="number" placeholder="Weight (kg)" value={state.weight_kg}
        onChange={(e) => setState({ ...state, weight_kg: Number(e.target.value) })} className="border p-2 rounded" />
      <input type="number" placeholder="Age" value={state.age}
        onChange={(e) => setState({ ...state, age: Number(e.target.value) })} className="border p-2 rounded" />
      <select value={state.sex} onChange={(e) => setState({ ...state, sex: e.target.value as "male" | "female" })} className="border p-2 rounded">
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
      <button onClick={submit} className="bg-black text-white p-2 rounded">See my targets</button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>,
  ];

  return <main className="flex min-h-screen items-center justify-center">{steps[step]}</main>;
}
```

- [ ] **Step 3: Verify** — sign up → wizard renders 4 steps → submitting shows "Your targets: X kcal, Yg protein" → row appears in `profiles` table in Supabase dashboard.

- [ ] **Step 4: Commit**

```bash
git add web/app/onboarding
git commit -m "feat: onboarding wizard (goal, rate, activity, stats)"
```

---

### Task 9: Dashboard page

**Files:**
- Create: `web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /profile` from Task 6.

- [ ] **Step 1: `web/app/dashboard/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const [targets, setTargets] = useState<{ kcal_target: number; protein_g: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Not logged in");
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/profile`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setError(`Load failed: ${res.status}`);
        return;
      }
      setTargets(await res.json());
    }
    load();
  }, []);

  if (error) return <main className="p-8">{error}</main>;
  if (!targets) return <main className="p-8">Loading...</main>;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-2xl">Your targets: {targets.kcal_target.toFixed(0)} kcal, {targets.protein_g.toFixed(0)}g protein</p>
    </main>
  );
}
```

- [ ] **Step 2: Verify** — log out, log back in, navigate to `/dashboard`, confirm the same targets reappear (proves persistence across logins — the actual exit-criteria test).

- [ ] **Step 3: Commit**

```bash
git add web/app/dashboard
git commit -m "feat: dashboard shows persisted targets"
```

---

### Task 10: README stub + exit-criteria verification pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write a one-paragraph project description into `README.md`**

```markdown
# TruPlate AI

AI nutrition tracker: log meals by photo, text, or voice; a multimodal LLM identifies foods and portions while real macro numbers come from the USDA database; two personalized AI assistants (Coach and Foodie) advise from your own logged history. Built by Shivaths as both a daily-use app and a full-stack + AI/ML resume project. Stack: Next.js + FastAPI + Supabase (Postgres/RLS/pgvector) + Gemini Flash + USDA FoodData Central.
```

- [ ] **Step 2: Run the full exit-criteria pass**

```bash
cd api && .venv\Scripts\activate && pytest
```
Expected: all green.

Manual pass: sign up as a brand-new user → complete the wizard → see targets → log out → log back in → same targets reappear on `/dashboard`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README project description (Phase 0 exit criteria)"
```

---

## Self-Review Notes

- **Spec coverage:** every `phase-0-checklist.md` section maps to a task — §1/2 (accounts/tools) confirmed already satisfied before this plan started; §3 → Tasks 1-2; §4 → Task 1 step 6 + gitignore already in place; §5 → Task 4; §6 → Tasks 5-6; §7 → Tasks 8-9; exit criteria → Task 10.
- **RLS enforcement:** deliberately chose per-request user-token auth (Task 6) over service-role-with-manual-filter, because CLAUDE.md's own line — "even a buggy endpoint can't read another user's rows" — only holds if RLS evaluates the real caller, not an all-powerful role. Flagging this choice per CLAUDE.md's "present trade-offs" instruction: the alternative (service key + app-level `WHERE user_id=`) is simpler to write but reduces RLS to decoration.
- **Type consistency:** `TargetsInput` (Task 3) is reused directly as the base of `ProfileIn` (Task 6) and constructed from Supabase row data in `get_profile` — same field names throughout (`weight_kg`, `height_cm`, `rate_lb_per_week`, etc.).
