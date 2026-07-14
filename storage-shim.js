/* ============================================================
   Shared storage shim — mimics the Claude-artifact window.storage
   API, backed by a real Supabase table so data is genuinely shared
   between the student and the advisor, on any device/browser.

   SETUP (one-time, ~5 minutes):
   1. Create a free project at https://supabase.com
   2. In the SQL editor, run:

        create table kv_store (
          key text primary key,
          value text not null,
          updated_at timestamptz default now()
        );

        alter table kv_store enable row level security;

        create policy "public read" on kv_store
          for select using (true);

        create policy "public write" on kv_store
          for insert with check (true);

        create policy "public update" on kv_store
          for update using (true);

      (This makes the table world-readable/writable by anyone with your
      anon key — fine for a small class project. If this ever needs to
      be more locked-down, restrict the policies later.)

   3. In Supabase, go to Project Settings → API and copy:
        - "Project URL"       → paste into SUPABASE_URL below
        - "anon public" key   → paste into SUPABASE_ANON_KEY below

   4. Deploy. Every visitor (student and advisor, any device) now reads
      and writes the same rows in kv_store — comments, statuses, and
      added papers show up for everyone.
   ============================================================ */

const SUPABASE_URL = "https://ukcchvzwwxrudczmstcq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yhEWZ0CCB4XjHbsaIue-fw_3pjY22Gk";

(function () {
  let clientPromise = null;

  function loadSupabaseScript() {
    if (window.supabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load Supabase client script"));
      document.head.appendChild(s);
    });
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        if (
          !SUPABASE_URL ||
          SUPABASE_URL.startsWith("PASTE_") ||
          !SUPABASE_ANON_KEY ||
          SUPABASE_ANON_KEY.startsWith("PASTE_")
        ) {
          throw new Error(
            "storage-shim.js: SUPABASE_URL / SUPABASE_ANON_KEY are not set yet. " +
            "Open public/storage-shim.js and paste in your Supabase project URL and anon key."
          );
        }
        await loadSupabaseScript();
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      })();
    }
    return clientPromise;
  }

  // "shared" is kept for API-compatibility with the original artifact
  // API. Everything in this shim is stored in the same shared table —
  // there is no meaningful "local-only" mode once a real backend is
  // wired up, so both true and false land in the same row space,
  // namespaced only by key.
  function rowKey(key) {
    return String(key);
  }

  window.storage = {
    async get(key, shared = false) {
      const client = await getClient();
      const { data, error } = await client
        .from("kv_store")
        .select("value")
        .eq("key", rowKey(key))
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Key not found: " + key);
      return { key, value: data.value, shared };
    },

    async set(key, value, shared = false) {
      const client = await getClient();
      const { error } = await client
        .from("kv_store")
        .upsert({ key: rowKey(key), value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return { key, value, shared };
    },

    async delete(key, shared = false) {
      const client = await getClient();
      const { error } = await client.from("kv_store").delete().eq("key", rowKey(key));
      if (error) throw new Error(error.message);
      return { key, deleted: true, shared };
    },

    async list(prefix = "", shared = false) {
      const client = await getClient();
      let query = client.from("kv_store").select("key");
      if (prefix) query = query.like("key", prefix + "%");
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { keys: (data || []).map((r) => r.key), prefix, shared };
    },
  };
})();
