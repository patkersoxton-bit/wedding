-- Advisor fix (extension_in_public lint): pg_trgm was created in `public`
-- by 0001. Move it to the conventional `extensions` schema. The existing
-- guests_name_idx keeps working — indexes reference the operator class by
-- OID, not by schema-qualified name — and search_guests only uses ILIKE,
-- which is built-in, so no function search_path changes are needed.
create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- Guarded so the migration is a no-op if pg_trgm is already in
-- `extensions` (hosted Supabase projects install it there by default).
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;
