import os

from dotenv import load_dotenv

# Must run before importing anything that reads env vars at import time (deps.py).
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
