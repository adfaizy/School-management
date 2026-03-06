import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient(url, anonKey)
    : null;

export const SUPABASE_ENABLED = !!supabase;

export async function loadSchools() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("schools").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function upsertSchool(row) {
  if (!supabase) return;
  const { error } = await supabase.from("schools").upsert(
    {
      id: row.id,
      name: row.name,
      settings: row.settings ?? {},
      students: row.students ?? [],
      timetable: row.timetable ?? {},
      exam_tm: row.exam_tm ?? {},
      exam_om: row.exam_om ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function deleteSchool(id) {
  if (!supabase) return;
  const { error } = await supabase.from("schools").delete().eq("id", id);
  if (error) throw error;
}
