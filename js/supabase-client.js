// Shared Supabase client, pointed at the hosted project (both values are
// safe to expose client-side; write access is enforced by RLS + the RPCs in
// supabase/migrations/, not by keeping this key secret). For local dev
// against the Docker stack, swap back to http://127.0.0.1:54321 and the
// local demo anon key printed by `npx supabase status`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://erkiyfvinmhduztnzecd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_42A5JpKb4rTKpUHl6Jh_kA_i35l9tPu';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// supabase-js normally resolves to a { data, error } shape, but when the
// database itself is unreachable (local instance not running, hosted
// project down, offline) the underlying fetch rejects instead — an
// unhandled rejection that looks like the UI silently doing nothing. Wrap
// any supabase call in this so every call site gets one consistent
// { data, error } shape to check, regardless of which way it failed.
export async function safeQuery(promise) {
  try {
    return await promise;
  } catch (err) {
    return { data: null, error: err };
  }
}

// Fetch-level failures mean the database couldn't be reached at all (local
// instance not running, hosted project down, offline) — show a friendly,
// non-technical message for those instead of leaking raw browser/network
// error text. supabase-js sometimes throws the raw fetch TypeError and
// sometimes wraps it in its own error class, so check both the type and
// the message text rather than relying on `instanceof TypeError` alone.
const NETWORK_ERROR_PATTERN = /failed to fetch|network|load failed|err_connection|err_internet/i;

export function friendlyErrorMessage(error, fallback) {
  const message = error?.message || '';
  if (error instanceof TypeError || NETWORK_ERROR_PATTERN.test(message)) {
    return "We can't reach the database right now. Please check your connection and try again in a moment.";
  }
  return message || fallback;
}
