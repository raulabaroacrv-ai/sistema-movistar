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
  const { data, error } = await supabase.from("movistar_data").select("data").eq("id", ROW_ID).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

export async function saveRemoteData(payload) {
  if (!supabase) return;
  const { error } = await supabase.from("movistar_data").upsert({ id: ROW_ID, data: payload, updated_at: new Date().toISOString() });
  if (error) throw error;
}
