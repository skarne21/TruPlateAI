import json
from datetime import date
from typing import Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from chat import (
    FOODIE_PROMPT,
    SYSTEM_PROMPT,
    build_recipe_tool,
    build_summary,
    build_tools,
    fetch_days,
    stream_reply,
    summarise_history,
)
from deps import get_current_user_client
from routes.profile import load_profile_row

router = APIRouter()



ASSISTANTS = ("coach", "foodie")


class ChatIn(BaseModel):
    message: str
    # The client's local date, for the same reason /log takes one: "today" is a
    # local-calendar question and the server does no timezone maths.
    today: date
    assistant: str = "coach"


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


def _conversation(client, user_id: str, assistant: str = "coach") -> tuple[str, list[dict]]:
    """This user's ongoing Coach conversation and its messages, in one round trip.

    The messages are embedded rather than fetched separately -- one round trip
    instead of two, and every round trip here is dead time before the model can
    start generating.
    """
    existing = (
        client.table("conversations")
        .select("id, messages(role, content, created_at)")
        .eq("user_id", user_id)
        .eq("assistant", assistant)
        .execute()
    ).data

    if existing:
        rows = sorted(existing[0].get("messages") or [], key=lambda m: m["created_at"])
        return existing[0]["id"], [
            {"role": r["role"], "content": r["content"]} for r in rows
        ]

    created = client.table("conversations").insert(
        {"user_id": user_id, "assistant": assistant}
    ).execute()
    return created.data[0]["id"], []


@router.get("/chat/history", response_model=list[Message])
def chat_history(assistant: str = "coach", user=Depends(get_current_user_client)):
    if assistant not in ASSISTANTS:
        raise HTTPException(400, f"Unknown assistant: {assistant}")
    user_id, client = user
    _, stored = _conversation(client, user_id, assistant)
    return [Message(**row) for row in stored]


@router.post("/chat")
def chat(body: ChatIn, user=Depends(get_current_user_client)):
    message = body.message.strip()
    if not message:
        raise HTTPException(400, "Say something first")
    if body.assistant not in ASSISTANTS:
        raise HTTPException(400, f"Unknown assistant: {body.assistant}")

    user_id, client = user
    profile = load_profile_row(client, user_id)
    conversation_id, stored = _conversation(client, user_id, body.assistant)
    history = summarise_history([*stored, {"role": "user", "content": message}])

    # Real numbers, computed in SQL, handed to the model as text.
    summary = build_summary(profile, body.today, fetch_days(client, user_id, body.today))
    tools = build_tools(client, user_id, body.today)

    if body.assistant == "foodie":
        # Exclusions come from the profile, not from anything the model can
        # set -- the recipe tool has no parameter for them at all.
        tools = [*tools, build_recipe_tool(client, profile.get("exclusions") or [])]
        prompt_template = FOODIE_PROMPT
    else:
        prompt_template = SYSTEM_PROMPT

    def persist(reply_text: str) -> None:
        if not reply_text.strip():
            return
        client.table("messages").insert([
            {"conversation_id": conversation_id, "user_id": user_id,
             "role": "user", "content": message},
            {"conversation_id": conversation_id, "user_id": user_id,
             "role": "assistant", "content": reply_text},
        ]).execute()

    reply = stream_reply(prompt_template.format(summary=summary), history, tools)
    return StreamingResponse(
        stream_ndjson(reply, persist),
        media_type="application/x-ndjson",
        # Proxies buffering a stream would defeat the point of streaming it.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
