import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The root used to render an API health-check readout left over from the
// Phase 0 scaffold. Redirecting on the server means no flash of the wrong
// page while a client-side session check resolves.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
