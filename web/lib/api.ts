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

  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...init, headers });
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
