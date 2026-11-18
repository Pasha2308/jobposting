-- ============================================================================
-- Seed: initial categories + application settings.
-- Safe to re-run (idempotent on conflict).
-- ============================================================================

insert into categories (name, slug, description, is_featured, sort_order) values
  ('Founder''s Office', 'founders-office',
   'Cross-functional roles inside a founder''s office: special projects, analysis, and execution alongside the CEO.', true, 10),
  ('Founder Associate', 'founder-associate',
   'Early-career roles that work directly with a founder across strategy, operations and growth.', true, 20),
  ('Chief of Staff', 'chief-of-staff',
   'Senior operator roles that run the founder''s operating cadence and high-priority initiatives.', true, 30),
  ('Strategy', 'strategy',
   'Corporate strategy, market research, planning and strategic finance roles in startups.', false, 40),
  ('Business Operations', 'business-operations',
   'Ops roles covering processes, vendor management, internal systems and execution.', false, 50),
  ('BizOps', 'bizops',
   'Analytical operations roles that sit between data, product and go-to-market.', false, 60),
  ('Growth', 'growth',
   'Growth marketing, demand, lifecycle, content, partnerships and experimentation.', true, 70),
  ('Startup Generalist', 'startup-generalist',
   'Wear-many-hats roles for people who want broad ownership in a small team.', false, 80),
  ('Startup Internships', 'startup-internships',
   'Internships and early-career programs at startups and ambitious teams.', true, 90),
  ('Other Startup Roles', 'other-startup-roles',
   'Relevant startup opportunities that do not fit the other categories.', false, 100)
on conflict (slug) do update set
  description = excluded.description,
  is_featured = excluded.is_featured,
  sort_order = excluded.sort_order;

insert into app_settings (key, value) values (
  'app',
  jsonb_build_object(
    'site_name', 'Hustler Community Opportunities',
    'site_url', 'https://hustlercommunity-opportunities.vercel.app',
    'verification_reminder_days', 14,
    'source_retention_days', 90,
    'public_submissions_enabled', true,
    'reports_enabled', true,
    'ai_provider', 'groq',
    'default_currency', 'INR'
  )
)
on conflict (key) do nothing;
