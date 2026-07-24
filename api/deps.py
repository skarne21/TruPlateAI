import os
from fastapi import Header, HTTPException
from supabase import create_client, Client
from supabase_auth.errors import AuthApiError

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]


def get_current_user_client(authorization: str = Header(...)) -> tuple[str, Client]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    # A token from a session that's since been signed out (e.g. the browser
    # raced a logout/login) raises AuthApiError rather than returning None --
    # must be caught here or it escapes as an unhandled 500 with no CORS
    # headers (Starlette's ServerErrorMiddleware sits outside CORSMiddleware).
    try:
        user_response = client.auth.get_user(token)
    except AuthApiError:
        raise HTTPException(401, "Invalid or expired token")
    if user_response.user is None:
        raise HTTPException(401, "Invalid or expired token")

    # Carry the user's token into Postgres calls so RLS evaluates auth.uid()
    # as this user, not the anon role.
    client.postgrest.auth(token)
    return user_response.user.id, client
