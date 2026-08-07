import os
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException
from supabase import Client, create_client
from supabase_auth.errors import AuthApiError

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]

# Supabase signs session tokens with an asymmetric key and publishes the public
# half, so signatures can be checked here instead of by asking Supabase about
# every request. Measured: ~100ms per network check against ~2ms locally.
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
JWT_AUDIENCE = "authenticated"

# Building a Supabase client costs ~900ms, almost all of it httpx constructing
# an SSL context. Doing that per request made JWT handling the slowest part of
# every endpoint. Cached per token, so each user session builds one client and
# reuses it -- tokens are never shared between users, so nothing leaks across
# them. Bounded because each entry holds an open connection pool.
CLIENT_CACHE_SIZE = 32


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    # Lazy: constructing this eagerly would make importing the module hit the
    # network, which the offline test suite must never do.
    return jwt.PyJWKClient(JWKS_URL, cache_keys=True)


@lru_cache(maxsize=CLIENT_CACHE_SIZE)
def _client_for_token(token: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    # Carry the user's token into Postgres calls so RLS evaluates auth.uid()
    # as this user, not the anon role.
    client.postgrest.auth(token)
    return client


def _user_id_from_token(token: str, client: Client) -> str:
    """Verify the token and return its subject.

    Signature and expiry are checked locally against Supabase's published key.
    If that can't be done -- an unexpected algorithm, or keys not published --
    fall back to asking Supabase, because failing closed here would take down
    every authenticated route.
    """
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=[signing_key.algorithm_name or "ES256"],
            audience=JWT_AUDIENCE,
        )
        return claims["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired token")
    except Exception:
        pass  # key lookup failed, not the token -- fall through to the network

    try:
        user_response = client.auth.get_user(token)
    except AuthApiError:
        raise HTTPException(401, "Invalid or expired token")
    if user_response.user is None:
        raise HTTPException(401, "Invalid or expired token")
    return user_response.user.id


def get_current_user_client(authorization: str = Header(...)) -> tuple[str, Client]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    client = _client_for_token(token)
    return _user_id_from_token(token, client), client
