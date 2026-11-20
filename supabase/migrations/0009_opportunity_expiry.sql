-- A job's public freshness window is anchored to its first discovered_at value.
-- Updating a listing or reprocessing the source must never renew this window.

alter table public.opportunities
  add column expires_at date;

update public.opportunities
set expires_at = (discovered_at at time zone 'UTC')::date + 90;

alter table public.opportunities
  alter column expires_at set not null;

create or replace function public.preserve_opportunity_discovery_age()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.discovered_at is distinct from old.discovered_at then
    new.discovered_at := old.discovered_at;
  end if;
  new.expires_at := (new.discovered_at at time zone 'UTC')::date + 90;
  return new;
end;
$$;

drop trigger if exists opportunities_preserve_discovery_age on public.opportunities;
create trigger opportunities_preserve_discovery_age
before insert or update on public.opportunities
for each row execute function public.preserve_opportunity_discovery_age();

create or replace function public.expire_stale_opportunities()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare affected integer;
begin
  update public.opportunities
  set status = 'expired',
      closed_at = coalesce(closed_at, now())
  where status = 'published'
    and expires_at <= current_date;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.preserve_opportunity_discovery_age() from public, anon, authenticated;
revoke all on function public.expire_stale_opportunities() from public, anon, authenticated;
grant execute on function public.expire_stale_opportunities() to service_role;

create index opportunities_expiry_idx
  on public.opportunities (expires_at)
  where status = 'published';
