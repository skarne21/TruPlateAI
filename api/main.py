import os

from dotenv import load_dotenv

# Must run before importing anything that reads env vars at import time (deps.py).
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import deps
from routes import analyze, chat, foods, meals, profile, weights

# Which front-end origins may call this API. Comma-separated so a deployed
# front end can be added without a code change, while the default keeps
# local development working. Deliberately not "*": a wildcard is invalid
# alongside allow_credentials, and every route here is authenticated.
def _origins(raw: str) -> list[str]:
    """Parse the comma-separated WEB_ORIGINS value.

    A space after a comma is the obvious way to get this wrong, and the
    result would reach a browser as a CORS error -- which in this project
    has three times meant something else entirely, so it is worth a test.
    """
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


WEB_ORIGINS = _origins(os.getenv("WEB_ORIGINS", "http://localhost:3000"))

app = FastAPI(title="TruPlate AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(profile.router)
app.include_router(analyze.router)
app.include_router(meals.router)
app.include_router(chat.router)
app.include_router(weights.router)
app.include_router(foods.router)


@app.get("/health/db")
def health_db():
    """A ping that actually reaches Postgres.

    Supabase pauses a free project after roughly a week without database
    activity. `/health` above answers without querying anything, so a keep-alive
    aimed at it would hold this API warm while the database slept underneath --
    the app would be dead with every check still passing green.

    Reads from the shared recipe corpus, which holds no user data. Row Level
    Security means an unauthenticated caller gets an empty list back, and that
    is fine: the point is to prove the round trip happened, not to read
    anything.

    Called through the module rather than an imported name so a test can
    substitute it -- importing a function copies it, and faking the original
    then leaves the copy running (a mistake this project has already made).
    """
    try:
        deps.anon_client().table("recipes").select("id").limit(1).execute()
    except Exception:
        raise HTTPException(503, "Database unreachable")
    return {"ok": True, "db": True}
