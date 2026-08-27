import { createClient } from "@/lib/supabase/client";

/** Call FastAPI with the current Supabase session token attached.
 *
 * Every backend route that touches user data verifies this JWT, so there is no
 * unauthenticated path worth having. Content-Type is deliberately left alone
 * for FormData bodies -- the browser has to set it itself to include the
 * multipart boundary.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  try {
    return await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...init, headers });
  } catch {
    // fetch only rejects when the request never reached the server at all --
    // API down, no network, blocked by CORS. The browser's own wording for
    // all three is "Failed to fetch", which every screen would then show the
    // user verbatim. Saying it once here fixes it for every caller.
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
}

/** Resolve the signed-in session, sending the user to /login if there isn't one.
 *
 * Every screen needs this same three lines before it can fetch anything, so it
 * lives here once. The router is taken structurally rather than by its Next
 * type -- all that's used is `replace`.
 */
export async function requireSession(router: { replace: (href: string) => void }) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) router.replace("/login");
  return session;
}

/** Upload a meal photo and return its storage path.
 *
 * Goes straight from the browser to Supabase Storage rather than through
 * FastAPI: no API key is involved, so there is nothing to protect, and the
 * bucket's RLS policy already scopes writes to the user's own {user_id}/ prefix.
 */
export async function uploadMealPhoto(blob: Blob): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const path = `${session.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from("meal-photos")
    .upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}
