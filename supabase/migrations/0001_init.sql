-- ============================================================================
-- Hustler Community Opportunities - initial schema
-- Runs on Supabase PostgreSQL (free tier compatible).
-- Apply with the Supabase SQL editor or `supabase db push`.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums (single source of truth for lifecycle / taxonomy values)
-- ----------------------------------------------------------------------------
create type opportunity_status as enum
  ('draft','pending_review','published','closed','expired','rejected','archived');
create type verification_status as enum
  ('not_verified','source_open','source_closed','uncertain','needs_verification');
create type work_mode as enum ('onsite','hybrid','remote','unspecified');
create type employment_type as enum ('full_time','part_time','contract','internship','temporary','unspecified');
create type application_method as enum ('external_url','email','linkedin_post','careers_page','other','none');
create type salary_period as enum ('annual','monthly','daily','hourly','stipend','unspecified');
create type date_precision as enum ('exact','month','year','unknown');
create type source_type as enum ('linkedin_post','company_website','recruiter_announcement','public_submission','other');
create type capture_status as enum
  ('received','validating','duplicate_check','awaiting_text','extracting','extraction_failed','needs_review','approved','rejected','published');
create type report_reason as enum ('closed','broken_link','incorrect_info','duplicate','suspicious','other');
create type report_status as enum ('open','reviewing','resolved','dismissed');
create type event_type as enum
  ('view','apply_click','email_click','source_click','careers_click','share','search');
create type admin_role as enum ('owner','admin','editor');
create type comment_style as enum ('professional','community','conversational');
create type ats_provider as enum ('greenhouse','lever','ashby','custom');
create type sync_status as enum ('idle','ok','error','disabled');

-- ----------------------------------------------------------------------------
-- Utility trigger
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_profiles
-- ----------------------------------------------------------------------------
create table admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'Administrator',
  role admin_role not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger admin_profiles_updated_at before update on admin_profiles
for each row execute function set_updated_at();

alter table admin_profiles enable row level security;
-- No policies: only the service role (server-side) may read/write. Admins are
-- verified by the server before any admin page or API is rendered.

-- ----------------------------------------------------------------------------
-- companies
-- ----------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique,
  website text,
  careers_url text,
  description text,
  logo_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index companies_name_lower_idx on companies (lower(name));
create index companies_verified_idx on companies (verified);
create trigger companies_updated_at before update on companies
for each row execute function set_updated_at();

alter table companies enable row level security;
create policy "public can read verified companies"
  on companies for select to anon, authenticated using (verified = true);

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_active_idx on categories (is_active, sort_order);
create trigger categories_updated_at before update on categories
for each row execute function set_updated_at();

alter table categories enable row level security;
create policy "public can read active categories"
  on categories for select to anon, authenticated using (is_active = true);

-- ----------------------------------------------------------------------------
-- source_captures (raw source text is private administrative material)
-- ----------------------------------------------------------------------------
create table source_captures (
  id uuid primary key default gen_random_uuid(),
  source_url text,
  normalized_source_key text,
  source_post_id text,
  source_type source_type not null default 'linkedin_post',
  raw_text text not null default '',
  submitted_company text,
  notes text,
  status capture_status not null default 'received',
  error_message text,
  extraction jsonb,
  extraction_confidence numeric(4,3) check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processing_started_at timestamptz,
  opportunity_id uuid,
  created_by text not null default 'admin',
  telegram_user_id bigint,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index source_captures_normalized_key_uidx
  on source_captures (normalized_source_key)
  where normalized_source_key is not null and status not in ('rejected','extraction_failed');
create index source_captures_status_idx on source_captures (status, created_at desc);
create index source_captures_telegram_idx on source_captures (telegram_user_id, status);
create index source_captures_source_url_idx on source_captures (source_url);
create trigger source_captures_updated_at before update on source_captures
for each row execute function set_updated_at();

alter table source_captures enable row level security;
-- No public policies. Raw post text is never exposed through the API.

-- ----------------------------------------------------------------------------
-- opportunities
-- ----------------------------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(trim(title)) between 3 and 160),
  company_id uuid references companies(id) on delete restrict,
  category_id uuid references categories(id) on delete restrict,
  summary text,
  responsibilities text[] not null default '{}',
  requirements text[] not null default '{}',
  skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',

  location_text text,
  city text,
  country text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  work_mode work_mode not null default 'unspecified',
  employment_type employment_type not null default 'unspecified',

  salary_min numeric(14,2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(14,2) check (salary_max is null or salary_max >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  salary_period salary_period not null default 'unspecified',
  experience_min_years numeric(4,1) check (experience_min_years is null or experience_min_years >= 0),
  experience_max_years numeric(4,1) check (experience_max_years is null or experience_max_years >= 0),

  application_method application_method not null default 'none',
  application_url text check (application_url is null or application_url ~* '^https?://'),
  recruitment_email text,
  careers_url text check (careers_url is null or careers_url ~* '^https?://'),
  application_instructions text,

  source_url text,
  source_type source_type,
  source_capture_id uuid references source_captures(id) on delete set null,
  canonical_source_key text,

  deadline date,
  original_posted_at date,
  original_date_precision date_precision not null default 'unknown',
  original_date_text text,

  status opportunity_status not null default 'draft',
  verification_status verification_status not null default 'not_verified',
  is_featured boolean not null default false,

  discovered_at timestamptz not null default now(),
  published_at timestamptz,
  last_verified_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  admin_notes text,
  created_by text,

  constraint salary_range_order check (salary_min is null or salary_max is null or salary_min <= salary_max),
  constraint experience_range_order check (
    experience_min_years is null or experience_max_years is null or experience_min_years <= experience_max_years
  ),
  constraint original_date_not_future check (original_posted_at is null or original_posted_at <= (current_date + 1)),
  constraint discovered_before_published check (published_at is null or published_at >= discovered_at),
  constraint deadline_after_original check (
    deadline is null or original_posted_at is null or deadline >= original_posted_at
  ),
  constraint published_needs_timestamp check (status <> 'published' or published_at is not null)
);

create unique index opportunities_canonical_source_uidx
  on opportunities (canonical_source_key)
  where canonical_source_key is not null and status not in ('rejected','archived');

create index opportunities_status_idx on opportunities (status);
create index opportunities_category_idx on opportunities (category_id);
create index opportunities_company_idx on opportunities (company_id);
create index opportunities_country_idx on opportunities (country);
create index opportunities_city_idx on opportunities (lower(city));
create index opportunities_discovered_idx on opportunities (discovered_at desc);
create index opportunities_published_idx on opportunities (published_at desc);
create index opportunities_work_mode_idx on opportunities (work_mode);
create index opportunities_employment_idx on opportunities (employment_type);
create index opportunities_source_url_idx on opportunities (source_url);
create index opportunities_deadline_idx on opportunities (deadline);
create index opportunities_status_published_idx on opportunities (status, published_at desc) where status = 'published';
create index opportunities_featured_idx on opportunities (is_featured) where is_featured = true;

create index opportunities_search_idx on opportunities using gin (
  (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(skills, ' '), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(location_text, '') || ' ' || coalesce(city, '') || ' ' || coalesce(country, '')), 'B')
  )
);

create trigger opportunities_updated_at before update on opportunities
for each row execute function set_updated_at();

-- Lifecycle transition guard -------------------------------------------------
create or replace function enforce_opportunity_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
      case old.status
        when 'draft' then new.status in ('pending_review','published','rejected','archived')
        when 'pending_review' then new.status in ('draft','published','rejected','archived')
        when 'published' then new.status in ('closed','expired','archived')
        when 'closed' then new.status in ('published','archived')
        when 'expired' then new.status in ('published','closed','archived')
        when 'rejected' then new.status in ('draft','pending_review','archived')
        when 'archived' then new.status in ('draft')
        else false
      end
    ) then
      raise exception 'Invalid lifecycle transition from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status in ('closed','expired') and new.closed_at is null then
      new.closed_at = now();
    end if;
    if new.status = 'published' then
      new.closed_at = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunities_transition_guard before update on opportunities
for each row execute function enforce_opportunity_transition();

-- Publication gate: mirrors src/lib/domain/validation.ts ----------------------
create or replace function enforce_publishable_opportunity()
returns trigger
language plpgsql
as $$
declare
  has_route boolean;
begin
  if new.status = 'published' then
    if coalesce(char_length(trim(new.title)), 0) < 3 then
      raise exception 'Published opportunity requires a title' using errcode = 'check_violation';
    end if;
    if new.company_id is null then
      raise exception 'Published opportunity requires a company' using errcode = 'check_violation';
    end if;
    if new.category_id is null then
      raise exception 'Published opportunity requires a category' using errcode = 'check_violation';
    end if;
    if coalesce(char_length(trim(new.summary)), 0) < 30 then
      raise exception 'Published opportunity requires a summary of at least 30 characters' using errcode = 'check_violation';
    end if;

    has_route :=
      (new.application_url is not null and new.application_url ~* '^https?://')
      or (new.recruitment_email is not null and new.recruitment_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
      or (new.careers_url is not null and new.careers_url ~* '^https?://')
      or (
        new.source_url is not null and new.source_url ilike '%linkedin.com%'
        and coalesce(char_length(trim(new.application_instructions)), 0) > 10
      );

    if not has_route then
      raise exception 'Published opportunity requires at least one usable application route'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunities_publish_gate before insert or update on opportunities
for each row execute function enforce_publishable_opportunity();

alter table opportunities enable row level security;
create policy "public can read live opportunities"
  on opportunities for select to anon, authenticated
  using (
    status = 'published'
    and closed_at is null
    and published_at is not null
    and (deadline is null or deadline >= current_date)
  );

-- ----------------------------------------------------------------------------
-- generated_comments
-- ----------------------------------------------------------------------------
create table generated_comments (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  style comment_style not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  is_selected boolean not null default false,
  manually_posted boolean not null default false,
  generated_by text not null default 'template' check (generated_by in ('template','ai')),
  version integer not null default 1 check (version >= 1),
  includes_listing_url boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index generated_comments_opportunity_idx on generated_comments (opportunity_id, created_at desc);
create index generated_comments_selected_idx on generated_comments (is_selected) where is_selected = true;
create trigger generated_comments_updated_at before update on generated_comments
for each row execute function set_updated_at();

alter table generated_comments enable row level security;
-- Admin-only. Never public.

-- ----------------------------------------------------------------------------
-- reports
-- ----------------------------------------------------------------------------
create table reports (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  reason report_reason not null,
  details text,
  contact_email text,
  status report_status not null default 'open',
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index reports_status_idx on reports (status, created_at desc);
create index reports_opportunity_idx on reports (opportunity_id);
alter table reports enable row level security;
-- No public select. Submissions are written by the server only.

-- ----------------------------------------------------------------------------
-- telegram_updates (webhook idempotency)
-- ----------------------------------------------------------------------------
create table telegram_updates (
  update_id bigint primary key,
  telegram_user_id bigint,
  update_type text,
  processed_at timestamptz not null default now()
);

alter table telegram_updates enable row level security;

-- ----------------------------------------------------------------------------
-- activity_logs
-- ----------------------------------------------------------------------------
create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index activity_logs_created_idx on activity_logs (created_at desc);
create index activity_logs_entity_idx on activity_logs (entity_type, entity_id);
alter table activity_logs enable row level security;

-- ----------------------------------------------------------------------------
-- opportunity_events (anonymous, aggregate)
-- ----------------------------------------------------------------------------
create table opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete set null,
  event_type event_type not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index opportunity_events_type_created_idx on opportunity_events (event_type, created_at desc);
create index opportunity_events_opportunity_idx on opportunity_events (opportunity_id, event_type);
create index opportunity_events_created_idx on opportunity_events (created_at desc);
alter table opportunity_events enable row level security;
-- Server-written only. No IP addresses, user agents or identities are stored.

-- ----------------------------------------------------------------------------
-- app_settings
-- ----------------------------------------------------------------------------
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_updated_at before update on app_settings
for each row execute function set_updated_at();

alter table app_settings enable row level security;

-- ----------------------------------------------------------------------------
-- company_sources - architecture for future authorised ATS integrations.
-- These rows are configuration only; no LinkedIn scraping exists anywhere.
-- ----------------------------------------------------------------------------
create table company_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider ats_provider not null,
  board_identifier text not null,
  source_url text,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  sync_status sync_status not null default 'idle',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, board_identifier)
);

create trigger company_sources_updated_at before update on company_sources
for each row execute function set_updated_at();

alter table company_sources enable row level security;

-- ----------------------------------------------------------------------------
-- Search RPC (public) - efficient, indexed, combined filters
-- ----------------------------------------------------------------------------
create or replace function search_public_opportunities(
  p_q text default null,
  p_category text default null,
  p_country text default null,
  p_city text default null,
  p_work_modes text[] default null,
  p_employment_types text[] default null,
  p_experience text default null,
  p_salary_disclosed boolean default false,
  p_currency text default null,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select
    o.*,
    c.name as joined_company_name,
    c.slug as joined_company_slug,
    c.website as joined_company_website,
    c.careers_url as joined_company_careers_url,
    c.description as joined_company_description,
    c.verified as joined_company_verified,
    cat.name as joined_category_name,
    cat.slug as joined_category_slug,
    (
      setweight(to_tsvector('simple', coalesce(o.title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(o.summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(o.skills, ' '), '')), 'C') ||
      setweight(to_tsvector('simple', coalesce(o.location_text,'') || ' ' || coalesce(o.city,'') || ' ' || coalesce(o.country,'')), 'B')
    ) as search_doc
  from opportunities o
  left join companies c on c.id = o.company_id
  left join categories cat on cat.id = o.category_id
  where o.status = 'published'
    and o.closed_at is null
    and o.published_at is not null
    and (o.deadline is null or o.deadline >= current_date)
    and (p_category is null or cat.slug = p_category)
    and (p_country is null or lower(o.country) = lower(p_country) or upper(o.country_code) = upper(p_country))
    and (p_city is null or lower(o.city) = lower(p_city))
    and (p_work_modes is null or array_length(p_work_modes, 1) is null or o.work_mode::text = any(p_work_modes))
    and (p_employment_types is null or array_length(p_employment_types, 1) is null or o.employment_type::text = any(p_employment_types))
    and (p_currency is null or o.currency = p_currency)
    and (not coalesce(p_salary_disclosed, false) or o.salary_min is not null or o.salary_max is not null)
    and (
      p_experience is null or p_experience = ''
      or (p_experience = 'entry' and coalesce(o.experience_min_years, 0) <= 2)
      or (p_experience = 'mid' and coalesce(o.experience_min_years, 0) between 2 and 5)
      or (p_experience = 'senior' and coalesce(o.experience_min_years, 0) >= 5)
    )
    and (
      p_q is null or trim(p_q) = ''
      or search_doc @@ websearch_to_tsquery('simple', p_q)
      or o.title ilike '%' || p_q || '%'
      or c.name ilike '%' || p_q || '%'
      or cat.name ilike '%' || p_q || '%'
      or o.city ilike '%' || p_q || '%'
      or o.country ilike '%' || p_q || '%'
      or exists (select 1 from unnest(o.skills) s where s ilike '%' || p_q || '%')
    )
),
counted as (select count(*)::integer as total from base),
paged as (
  select * from base
  order by
    case when p_sort = 'oldest' then discovered_at end asc nulls last,
    case when p_sort = 'source_date' then original_posted_at end desc nulls last,
    case when p_sort = 'relevance' and p_q is not null and trim(p_q) <> ''
      then ts_rank(search_doc, websearch_to_tsquery('simple', p_q)) end desc nulls last,
    discovered_at desc
  limit greatest(1, least(coalesce(p_page_size, 12), 48))
  offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 12), 48))
)
select jsonb_build_object(
  'total', (select total from counted),
  'items', coalesce((
    select jsonb_agg(
      (to_jsonb(p) - 'joined_company_name' - 'joined_company_slug' - 'joined_company_website'
        - 'joined_company_careers_url' - 'joined_company_description' - 'joined_company_verified'
        - 'joined_category_name' - 'joined_category_slug' - 'search_doc' - 'admin_notes' - 'created_by')
      || jsonb_build_object(
        'company', case when p.company_id is null then null else jsonb_build_object(
          'id', p.company_id, 'name', p.joined_company_name, 'slug', p.joined_company_slug,
          'website', p.joined_company_website, 'careers_url', p.joined_company_careers_url,
          'description', p.joined_company_description, 'verified', p.joined_company_verified
        ) end,
        'category', case when p.category_id is null then null else jsonb_build_object(
          'id', p.category_id, 'name', p.joined_category_name, 'slug', p.joined_category_slug
        ) end
      )
      order by p.discovered_at desc
    )
    from paged p
  ), '[]'::jsonb)
);
$$;

-- ----------------------------------------------------------------------------
-- Admin list RPC
-- ----------------------------------------------------------------------------
create or replace function admin_list_opportunities(
  p_q text default null,
  p_status text default null,
  p_category text default null,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select
    o.*,
    c.name as joined_company_name, c.slug as joined_company_slug,
    c.website as joined_company_website, c.careers_url as joined_company_careers_url,
    c.description as joined_company_description, c.verified as joined_company_verified,
    cat.name as joined_category_name, cat.slug as joined_category_slug
  from opportunities o
  left join companies c on c.id = o.company_id
  left join categories cat on cat.id = o.category_id
  where (p_status is null or p_status = '' or o.status::text = p_status)
    and (p_category is null or p_category = '' or cat.slug = p_category)
    and (
      p_q is null or trim(p_q) = ''
      or o.title ilike '%' || p_q || '%'
      or c.name ilike '%' || p_q || '%'
      or cat.name ilike '%' || p_q || '%'
      or o.city ilike '%' || p_q || '%'
      or o.country ilike '%' || p_q || '%'
      or o.source_url ilike '%' || p_q || '%'
    )
),
counted as (select count(*)::integer as total from base),
paged as (
  select * from base
  order by
    case when p_sort = 'oldest' then discovered_at end asc nulls last,
    case when p_sort = 'updated' then updated_at end desc nulls last,
    case when p_sort = 'title' then lower(title) end asc,
    discovered_at desc
  limit greatest(1, least(coalesce(p_page_size, 25), 100))
  offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 25), 100))
)
select jsonb_build_object(
  'total', (select total from counted),
  'items', coalesce((
    select jsonb_agg(
      (to_jsonb(p) - 'joined_company_name' - 'joined_company_slug' - 'joined_company_website'
        - 'joined_company_careers_url' - 'joined_company_description' - 'joined_company_verified'
        - 'joined_category_name' - 'joined_category_slug')
      || jsonb_build_object(
        'company', case when p.company_id is null then null else jsonb_build_object(
          'id', p.company_id, 'name', p.joined_company_name, 'slug', p.joined_company_slug,
          'website', p.joined_company_website, 'careers_url', p.joined_company_careers_url,
          'description', p.joined_company_description, 'verified', p.joined_company_verified
        ) end,
        'category', case when p.category_id is null then null else jsonb_build_object(
          'id', p.category_id, 'name', p.joined_category_name, 'slug', p.joined_category_slug
        ) end
      )
      order by p.discovered_at desc
    )
    from paged p
  ), '[]'::jsonb)
);
$$;

-- ----------------------------------------------------------------------------
-- Homepage sections RPC
-- ----------------------------------------------------------------------------
create or replace function homepage_sections(p_limit integer default 6)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with live as (
  select o.*, c.name as company_name, c.slug as company_slug, c.verified as company_verified,
         c.website as company_website, c.careers_url as company_careers_url,
         c.description as company_description,
         cat.name as category_name, cat.slug as category_slug
  from opportunities o
  left join companies c on c.id = o.company_id
  left join categories cat on cat.id = o.category_id
  where o.status = 'published' and o.closed_at is null and o.published_at is not null
    and (o.deadline is null or o.deadline >= current_date)
),
shape as (
  select jsonb_build_object(
    'id', id, 'slug', slug, 'title', title, 'company_id', company_id, 'category_id', category_id,
    'summary', summary, 'responsibilities', responsibilities, 'requirements', requirements,
    'skills', skills, 'preferred_skills', preferred_skills,
    'location_text', location_text, 'city', city, 'country', country, 'country_code', country_code,
    'work_mode', work_mode, 'employment_type', employment_type,
    'salary_min', salary_min, 'salary_max', salary_max, 'currency', currency, 'salary_period', salary_period,
    'experience_min_years', experience_min_years, 'experience_max_years', experience_max_years,
    'application_method', application_method, 'application_url', application_url,
    'recruitment_email', recruitment_email, 'careers_url', careers_url,
    'application_instructions', application_instructions,
    'source_url', source_url, 'source_type', source_type, 'source_capture_id', source_capture_id,
    'deadline', deadline, 'original_posted_at', original_posted_at,
    'original_date_precision', original_date_precision, 'original_date_text', original_date_text,
    'status', status, 'verification_status', verification_status, 'is_featured', is_featured,
    'discovered_at', discovered_at, 'published_at', published_at, 'last_verified_at', last_verified_at,
    'closed_at', closed_at, 'created_at', created_at, 'updated_at', updated_at,
    'admin_notes', null,
    'company', case when company_id is null then null else jsonb_build_object(
      'id', company_id, 'name', company_name, 'slug', company_slug,
      'website', company_website, 'careers_url', company_careers_url,
      'description', company_description, 'verified', company_verified
    ) end,
    'category', case when category_id is null then null else jsonb_build_object(
      'id', category_id, 'name', category_name, 'slug', category_slug
    ) end
  ) as item,
  discovered_at, is_featured, work_mode, employment_type
  from live
),
latest as (
  select item, discovered_at, published_at from shape
  order by published_at desc nulls last, discovered_at desc
  limit greatest(1, p_limit)
),
remote as (select item, discovered_at from shape where work_mode = 'remote' order by discovered_at desc limit greatest(1, p_limit)),
internships as (select item, discovered_at from shape where employment_type = 'internship' order by discovered_at desc limit greatest(1, p_limit)),
featured as (select item, discovered_at from shape where is_featured order by discovered_at desc limit greatest(1, p_limit)),
category_counts as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cat.id, 'slug', cat.slug, 'name', cat.name, 'description', cat.description,
    'is_active', cat.is_active, 'is_featured', cat.is_featured, 'sort_order', cat.sort_order,
    'opportunity_count', coalesce(cnt.n, 0)
  ) order by cat.sort_order, cat.name), '[]'::jsonb) as data
  from categories cat
  left join (
    select category_id, count(*)::integer n from live group by category_id
  ) cnt on cnt.category_id = cat.id
  where cat.is_active = true
),
location_counts as (
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'country', country, 'count', n) order by n desc, city), '[]'::jsonb) as data
  from (
    select city, country, count(*)::integer n
    from live
    where city is not null and trim(city) <> ''
    group by city, country
    order by n desc
    limit 8
  ) l
)
select jsonb_build_object(
  'latest', coalesce((select jsonb_agg(item order by discovered_at desc) from latest), '[]'::jsonb),
  'recentlyDiscovered', coalesce((select jsonb_agg(item order by discovered_at desc) from latest), '[]'::jsonb),
  'remote', coalesce((select jsonb_agg(item order by discovered_at desc) from remote), '[]'::jsonb),
  'internships', coalesce((select jsonb_agg(item order by discovered_at desc) from internships), '[]'::jsonb),
  'featured', coalesce((select jsonb_agg(item order by discovered_at desc) from featured), '[]'::jsonb),
  'categories', (select data from category_counts),
  'locations', (select data from location_counts),
  'totalPublished', (select count(*)::integer from live)
);
$$;

-- ----------------------------------------------------------------------------
-- Admin dashboard statistics
-- ----------------------------------------------------------------------------
create or replace function admin_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  'total', (select count(*)::integer from opportunities),
  'published', (select count(*)::integer from opportunities where status = 'published'),
  'pending_review', (select count(*)::integer from opportunities where status = 'pending_review'),
  'draft', (select count(*)::integer from opportunities where status = 'draft'),
  'closed', (select count(*)::integer from opportunities where status = 'closed'),
  'expired', (select count(*)::integer from opportunities where status = 'expired'),
  'rejected', (select count(*)::integer from opportunities where status = 'rejected'),
  'archived', (select count(*)::integer from opportunities where status = 'archived'),
  'added_today', (select count(*)::integer from opportunities where created_at >= current_date),
  'published_today', (select count(*)::integer from opportunities where published_at >= current_date),
  'needs_verification', (
    select count(*)::integer from opportunities
    where status = 'published'
      and (
        deadline < current_date
        or last_verified_at is null
        or last_verified_at < now() - (coalesce(
          (select (value->>'verification_reminder_days')::int from app_settings where key = 'app'), 14
        ) || ' days')::interval
        or verification_status in ('needs_verification','uncertain','source_closed')
      )
  ),
  'duplicate_captures', (
    select count(*)::integer from source_captures sc
    where sc.status in ('needs_review','received','extraction_failed')
      and sc.normalized_source_key is not null
      and exists (
        select 1 from source_captures other
        where other.id <> sc.id and other.normalized_source_key = sc.normalized_source_key
      )
  ),
  'open_reports', (select count(*)::integer from reports where status in ('open','reviewing')),
  'total_captures', (select count(*)::integer from source_captures)
);
$$;

-- ----------------------------------------------------------------------------
-- Analytics summary
-- ----------------------------------------------------------------------------
create or replace function analytics_summary(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with window_events as (
  select * from opportunity_events
  where created_at >= now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval
),
counts as (
  select
    count(*) filter (where event_type = 'view')::integer as views,
    count(*) filter (where event_type = 'apply_click')::integer as apply_clicks,
    count(*) filter (where event_type = 'email_click')::integer as email_clicks,
    count(*) filter (where event_type = 'source_click')::integer as source_clicks,
    count(*) filter (where event_type = 'careers_click')::integer as careers_clicks,
    count(*) filter (where event_type = 'share')::integer as shares,
    count(*) filter (where event_type = 'search')::integer as searches
  from window_events
),
top_opps as (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'slug', slug, 'count', n) order by n desc), '[]'::jsonb) data
  from (
    select o.id, o.title, o.slug, count(e.id)::integer n
    from window_events e
    join opportunities o on o.id = e.opportunity_id
    where e.event_type in ('view','apply_click','email_click','source_click','careers_click')
    group by o.id, o.title, o.slug
    order by n desc limit 8
  ) t
),
top_cats as (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug, 'count', n) order by n desc), '[]'::jsonb) data
  from (
    select cat.id, cat.name, cat.slug, count(e.id)::integer n
    from window_events e
    join opportunities o on o.id = e.opportunity_id
    join categories cat on cat.id = o.category_id
    where e.event_type in ('view','apply_click')
    group by cat.id, cat.name, cat.slug
    order by n desc limit 8
  ) t
),
trend as (
  select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'count', coalesce(c.n, 0)) order by d), '[]'::jsonb) data
  from generate_series(current_date - 29, current_date, '1 day') d
  left join (
    select published_at::date day, count(*)::integer n
    from opportunities where published_at is not null
    group by 1
  ) c on c.day = d::date
),
daily as (
  select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'views', coalesce(v.n, 0), 'applyClicks', coalesce(a.n, 0)) order by d), '[]'::jsonb) data
  from generate_series(current_date - 29, current_date, '1 day') d
  left join (select created_at::date day, count(*)::integer n from window_events where event_type = 'view' group by 1) v on v.day = d::date
  left join (select created_at::date day, count(*)::integer n from window_events where event_type = 'apply_click' group by 1) a on a.day = d::date
),
top_searches as (
  select coalesce(jsonb_agg(jsonb_build_object('query', query, 'count', n) order by n desc), '[]'::jsonb) data
  from (
    select lower(trim(metadata->>'query')) query, count(*)::integer n
    from window_events
    where event_type = 'search' and metadata ? 'query' and length(trim(metadata->>'query')) between 1 and 120
    group by 1 order by n desc limit 8
  ) t
)
select jsonb_build_object(
  'views', (select views from counts),
  'applyClicks', (select apply_clicks from counts),
  'emailClicks', (select email_clicks from counts),
  'sourceClicks', (select source_clicks from counts),
  'careersClicks', (select careers_clicks from counts),
  'shares', (select shares from counts),
  'searches', (select searches from counts),
  'topOpportunities', (select data from top_opps),
  'topCategories', (select data from top_cats),
  'publicationTrend', (select data from trend),
  'dailyEvents', (select data from daily),
  'topSearches', (select data from top_searches)
);
$$;

-- ----------------------------------------------------------------------------
-- Verification queue
-- ----------------------------------------------------------------------------
create or replace function opportunities_needing_verification(p_days integer default 14)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with joined as (
  select o.*, c.name company_name, cat.name category_name
  from opportunities o
  left join companies c on c.id = o.company_id
  left join categories cat on cat.id = o.category_id
  where o.status = 'published'
    and (
      (o.deadline is not null and o.deadline < current_date)
      or o.last_verified_at is null
      or o.last_verified_at < now() - (greatest(1, p_days) || ' days')::interval
      or o.verification_status in ('needs_verification','uncertain','source_closed')
    )
  order by o.deadline nulls last, o.last_verified_at nulls first
  limit 100
)
select coalesce(jsonb_agg(to_jsonb(joined) || jsonb_build_object(
  'company', jsonb_build_object('id', company_id, 'name', company_name),
  'category', jsonb_build_object('id', category_id, 'name', category_name)
) order by deadline nulls last), '[]'::jsonb)
from joined;
$$;

-- ----------------------------------------------------------------------------
-- Privileges: only the service role calls these RPCs. The anon key is used
-- solely for Supabase Auth on the server.
-- ----------------------------------------------------------------------------
revoke execute on function search_public_opportunities(text,text,text,text,text[],text[],text,boolean,text,text,integer,integer) from public, anon, authenticated;
revoke execute on function admin_list_opportunities(text,text,text,text,integer,integer) from public, anon, authenticated;
revoke execute on function homepage_sections(integer) from public, anon, authenticated;
revoke execute on function admin_dashboard_stats() from public, anon, authenticated;
revoke execute on function analytics_summary(integer) from public, anon, authenticated;
revoke execute on function opportunities_needing_verification(integer) from public, anon, authenticated;

grant execute on function search_public_opportunities(text,text,text,text,text[],text[],text,boolean,text,text,integer,integer) to service_role;
grant execute on function admin_list_opportunities(text,text,text,text,integer,integer) to service_role;
grant execute on function homepage_sections(integer) to service_role;
grant execute on function admin_dashboard_stats() to service_role;
grant execute on function analytics_summary(integer) to service_role;
grant execute on function opportunities_needing_verification(integer) to service_role;
