from dotenv import load_dotenv

# Must run before importing anything that reads env vars at import time (deps.py).
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import analyze, chat, meals, profile

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


app.include_router(profile.router)
app.include_router(analyze.router)
app.include_router(meals.router)
app.include_router(chat.router)
