/**
 * Live probe for search_approved_users (same client shape as the app).
 * Reads VITE_* from process env or .env; credentials from %TEMP%/nexa_verify_user.json
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadDotEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const credPath = resolve(process.env.TEMP || "/tmp", "nexa_verify_user.json");
const raw = readFileSync(credPath, "utf8").replace(/^\uFEFF/, "");
const cred = JSON.parse(raw);

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
  email: cred.email,
  password: cred.password,
});
if (authErr) {
  console.error("LOGIN_FAIL", authErr.message);
  process.exit(1);
}

const uid = authData.user.id;
const { data: profile } = await supabase
  .from("profiles")
  .select("username, role, approval_status")
  .eq("id", uid)
  .maybeSingle();

const { data: approvedFlag, error: apprErr } = await supabase.rpc("is_approved_user");
const { data: searchData, error: searchErr } = await supabase.rpc("search_approved_users", {
  search_text: "nx",
  result_limit: 20,
});
const { data: search2, error: err2 } = await supabase.rpc("search_approved_users", {
  search_text: "ab",
});

console.log(
  JSON.stringify(
    {
      LOGIN_OK: true,
      PROFILE: profile,
      is_approved_user: approvedFlag,
      is_approved_err: apprErr?.message || null,
      SEARCH_ERR: searchErr ? searchErr.message : null,
      SEARCH_LEN: Array.isArray(searchData) ? searchData.length : searchData,
      SEARCH_SAMPLE: Array.isArray(searchData) ? searchData.slice(0, 3) : null,
      SEARCH2_ERR: err2?.message || null,
      SEARCH2_LEN: Array.isArray(search2) ? search2.length : search2,
    },
    null,
    2
  )
);

await supabase.auth.signOut();
