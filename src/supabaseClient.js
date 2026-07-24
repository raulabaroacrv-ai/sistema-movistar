import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = supabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// The whole app state (clientes, ventas, inventario, creditos, etc.) is stored as one
// JSON blob in a single row (id = 'main') of the `movistar_data` table. This mirrors the
// original window.storage.get/set pattern exactly, so none of the business logic in the
// rest of the app needs to change — only how that one object is loaded and saved.
const ROW_ID = "main";

export async function loadRemoteData() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("movistar_data").select("data, updated_at").eq("id", ROW_ID).maybeSingle();
  if (error) throw error;
  return data ? { data: data.data, updatedAt: data.updated_at } : null;
}

// Optimistic concurrency: only overwrite the row if nobody else has saved since we last
// loaded/saved it (checked via updated_at). This protects against two open tabs/devices
// silently stomping on each other's changes — if someone else saved in the meantime, this
// returns { conflict: true } instead of overwriting their data, so the caller can warn the
// user to reload before continuing instead of losing data silently.
export async function saveRemoteData(payload, expectedUpdatedAt) {
  if (!supabase) return { conflict: false, updatedAt: null };
  const nowIso = new Date().toISOString();
  let query = supabase.from("movistar_data").update({ data: payload, updated_at: nowIso }).eq("id", ROW_ID);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("updated_at");
  if (error) throw error;
  if (expectedUpdatedAt && (!data || data.length === 0)) {
    return { conflict: true, updatedAt: expectedUpdatedAt };
  }
  return { conflict: false, updatedAt: (data && data[0] && data[0].updated_at) || nowIso };
}
