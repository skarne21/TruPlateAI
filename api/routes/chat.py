import json
from datetime import date
from typing import Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat import (
    SYSTEM_PROMPT,
    build_summary,
    build_tools,
    fetch_days,
    stream_reply,
    summarise_history,
)
from deps import get_current_user_client
from routes.profile import load_profile_row

router = APIRouter()

ASSISTANT = "coach"


class ChatIn(BaseModel):
    message: str
    # The client's local date, for the same reason /log takes one: "today" is a
    # local-calendar question and the server does no timezone maths.
    today: date


class Message(BaseModel):
    role: str
    content: str


def stream_ndjson(
    reply: Iterator[str], on_complete: Callable[[str], None]
) -> Iterator[str]:
    """Frame a text stream as newline-delimited JSON.

    One JSON object per line: chunks while generating, then a final `done`. A
    failure partway through has to be reported *inside* the stream, because the
    response committed to HTTP 200 the moment the first chunk was flushed.
    """
    collected: list[str] = []
    try:
        for text in reply:
            collected.append(text)
            yield json.dumps({"type": "chunk", "text": text}) + "\n"
    except Exception as e:
        yield json.dumps({"type": "error", "message": f"The Coach stopped early: {e}"}) + "\n"
        return  # deliberately not persisted -- see test_partial_reply_is_not_persisted

    on_complete("".join(collected))
    yield json.dumps({"type": "done"}) + "\n"


def _conversation_id(client, user_id: str) -> str:
    """Fetch or create this user's single ongoing Coach conversation."""
    existing = (
        client.table("conversations")
        .select("id")
        .eq("user_id", user_id)
        .eq("assistant", ASSISTANT)
        .execute()
    ).data
    if existing:
        return existing[0]["id"]

    created = client.table("conversations").insert(
        {"user_id": user_id, "assistant": ASSISTANT}
    ).execute()
    return created.data[0]["id"]


@router.get("/chat/history", response_model=list[Message])
def chat_history(user=Depends(get_current_user_client)):
    user_id, client = user
    conversation_id = _conversation_id(client, user_id)
    rows = (
        client.table("messages")
        .select("role, content")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    ).data
    return [Message(**row) for row in rows]


@router.post("/chat")
def chat(body: ChatIn, user=Depends(get_current_user_client)):
    message = body.message.strip()
    if not message:
        raise HTTPException(400, "Say something first")

    user_id, client = user
    profile = load_profile_row(client, user_id)
    conversation_id = _conversation_id(client, user_id)

    stored = (
        client.table("messages")
        .select("role, content")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    ).data
    history = summarise_history([*stored, {"role": "user", "content": message}])

    # Real numbers, computed in SQL, handed to the model as text.
    summary = build_summary(profile, body.today, fetch_days(client, user_id, body.today))
    tools = build_tools(client, user_id, body.today)

    def persist(reply_text: str) -> None:
        if not reply_text.strip():
            return
        client.table("messages").insert([
            {"conversation_id": conversation_id, "user_id": user_id,
             "role": "user", "content": message},
            {"conversation_id": conversation_id, "user_id": user_id,
             "role": "assistant", "content": reply_text},
        ]).execute()

    reply = stream_reply(SYSTEM_PROMPT.format(summary=summary), history, tools)
    return StreamingResponse(
        stream_ndjson(reply, persist),
        media_type="application/x-ndjson",
        # Proxies buffering a stream would defeat the point of streaming it.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
