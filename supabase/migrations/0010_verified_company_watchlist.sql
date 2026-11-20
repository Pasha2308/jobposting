-- Verified official public ATS feeds. The first 10 are active; later batches unlock one per week.
alter table company_sources
  add column if not exists is_active boolean not null default false,
  add column if not exists activation_batch smallint,
  add column if not exists activated_at timestamptz;

-- Existing operator-configured sources remain enabled; the new catalog is staged separately.
update company_sources set is_active = true, activated_at = coalesce(activated_at, now())
where activation_batch is null and sync_status <> 'disabled';

create table if not exists company_source_activation_state (
  id boolean primary key default true check (id),
  active_batch smallint not null default 1 check (active_batch between 1 and 10),
  last_activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table company_source_activation_state enable row level security;
revoke all on company_source_activation_state from anon, authenticated;

insert into company_source_activation_state (id, active_batch, last_activated_at)
values (true, 1, now()) on conflict (id) do nothing;

-- (company, ATS board, provider, career page, tested public feed, weekly batch)
with roster(company_name, board_identifier, provider, career_url, feed_url, activation_batch) as (
values
  ('Stripe', 'stripe', 'greenhouse', 'https://boards.greenhouse.io/stripe', 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false', 1),
  ('Ramp', 'ramp', 'greenhouse', 'https://boards.greenhouse.io/ramp', 'https://boards-api.greenhouse.io/v1/boards/ramp/jobs?content=false', 1),
  ('Brex', 'brex', 'greenhouse', 'https://boards.greenhouse.io/brex', 'https://boards-api.greenhouse.io/v1/boards/brex/jobs?content=false', 1),
  ('Gusto', 'gusto', 'greenhouse', 'https://boards.greenhouse.io/gusto', 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=false', 1),
  ('Mercury', 'mercury', 'greenhouse', 'https://boards.greenhouse.io/mercury', 'https://boards-api.greenhouse.io/v1/boards/mercury/jobs?content=false', 1),
  ('Vercel', 'vercel', 'greenhouse', 'https://boards.greenhouse.io/vercel', 'https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=false', 1),
  ('Figma', 'figma', 'greenhouse', 'https://boards.greenhouse.io/figma', 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=false', 1),
  ('Anthropic', 'anthropic', 'greenhouse', 'https://boards.greenhouse.io/anthropic', 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=false', 1),
  ('Datadog', 'datadog', 'greenhouse', 'https://boards.greenhouse.io/datadog', 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=false', 1),
  ('Fivetran', 'fivetran', 'greenhouse', 'https://boards.greenhouse.io/fivetran', 'https://boards-api.greenhouse.io/v1/boards/fivetran/jobs?content=false', 1),
  ('Affirm', 'affirm', 'greenhouse', 'https://boards.greenhouse.io/affirm', 'https://boards-api.greenhouse.io/v1/boards/affirm/jobs?content=false', 2),
  ('Asana', 'asana', 'greenhouse', 'https://boards.greenhouse.io/asana', 'https://boards-api.greenhouse.io/v1/boards/asana/jobs?content=false', 2),
  ('Calendly', 'calendly', 'greenhouse', 'https://boards.greenhouse.io/calendly', 'https://boards-api.greenhouse.io/v1/boards/calendly/jobs?content=false', 2),
  ('Circleci', 'circleci', 'greenhouse', 'https://boards.greenhouse.io/circleci', 'https://boards-api.greenhouse.io/v1/boards/circleci/jobs?content=false', 2),
  ('Coinbase', 'coinbase', 'greenhouse', 'https://boards.greenhouse.io/coinbase', 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=false', 2),
  ('Elastic', 'elastic', 'greenhouse', 'https://boards.greenhouse.io/elastic', 'https://boards-api.greenhouse.io/v1/boards/elastic/jobs?content=false', 2),
  ('Faire', 'faire', 'greenhouse', 'https://boards.greenhouse.io/faire', 'https://boards-api.greenhouse.io/v1/boards/faire/jobs?content=false', 2),
  ('Fastly', 'fastly', 'greenhouse', 'https://boards.greenhouse.io/fastly', 'https://boards-api.greenhouse.io/v1/boards/fastly/jobs?content=false', 2),
  ('GitLab', 'gitlab', 'greenhouse', 'https://boards.greenhouse.io/gitlab', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=false', 2),
  ('Instacart', 'instacart', 'greenhouse', 'https://boards.greenhouse.io/instacart', 'https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=false', 2),
  ('ZipRecruiter', 'ziprecruiter', 'greenhouse', 'https://boards.greenhouse.io/ziprecruiter', 'https://boards-api.greenhouse.io/v1/boards/ziprecruiter/jobs?content=false', 3),
  ('Jamf', 'jamf', 'greenhouse', 'https://boards.greenhouse.io/jamf', 'https://boards-api.greenhouse.io/v1/boards/jamf/jobs?content=false', 3),
  ('Lyft', 'lyft', 'greenhouse', 'https://boards.greenhouse.io/lyft', 'https://boards-api.greenhouse.io/v1/boards/lyft/jobs?content=false', 3),
  ('Mixpanel', 'mixpanel', 'greenhouse', 'https://boards.greenhouse.io/mixpanel', 'https://boards-api.greenhouse.io/v1/boards/mixpanel/jobs?content=false', 3),
  ('Nuro', 'nuro', 'greenhouse', 'https://boards.greenhouse.io/nuro', 'https://boards-api.greenhouse.io/v1/boards/nuro/jobs?content=false', 3),
  ('Okta', 'okta', 'greenhouse', 'https://boards.greenhouse.io/okta', 'https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=false', 3),
  ('Oscar Health', 'oscar', 'greenhouse', 'https://boards.greenhouse.io/oscar', 'https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=false', 3),
  ('PagerDuty', 'pagerduty', 'greenhouse', 'https://boards.greenhouse.io/pagerduty', 'https://boards-api.greenhouse.io/v1/boards/pagerduty/jobs?content=false', 3),
  ('Pinterest', 'pinterest', 'greenhouse', 'https://boards.greenhouse.io/pinterest', 'https://boards-api.greenhouse.io/v1/boards/pinterest/jobs?content=false', 3),
  ('Samsara', 'samsara', 'greenhouse', 'https://boards.greenhouse.io/samsara', 'https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=false', 3),
  ('Block', 'block', 'greenhouse', 'https://boards.greenhouse.io/block', 'https://boards-api.greenhouse.io/v1/boards/block/jobs?content=false', 4),
  ('Twilio', 'twilio', 'greenhouse', 'https://boards.greenhouse.io/twilio', 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=false', 4),
  ('Upstart', 'upstart', 'greenhouse', 'https://boards.greenhouse.io/upstart', 'https://boards-api.greenhouse.io/v1/boards/upstart/jobs?content=false', 4),
  ('Waymo', 'waymo', 'greenhouse', 'https://boards.greenhouse.io/waymo', 'https://boards-api.greenhouse.io/v1/boards/waymo/jobs?content=false', 4),
  ('Airbnb', 'airbnb', 'greenhouse', 'https://boards.greenhouse.io/airbnb', 'https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=false', 4),
  ('Coursera', 'coursera', 'greenhouse', 'https://boards.greenhouse.io/coursera', 'https://boards-api.greenhouse.io/v1/boards/coursera/jobs?content=false', 4),
  ('Duolingo', 'duolingo', 'greenhouse', 'https://boards.greenhouse.io/duolingo', 'https://boards-api.greenhouse.io/v1/boards/duolingo/jobs?content=false', 4),
  ('Flexport', 'flexport', 'greenhouse', 'https://boards.greenhouse.io/flexport', 'https://boards-api.greenhouse.io/v1/boards/flexport/jobs?content=false', 4),
  ('Justworks', 'justworks', 'greenhouse', 'https://boards.greenhouse.io/justworks', 'https://boards-api.greenhouse.io/v1/boards/justworks/jobs?content=false', 4),
  ('Lattice', 'lattice', 'greenhouse', 'https://boards.greenhouse.io/lattice', 'https://boards-api.greenhouse.io/v1/boards/lattice/jobs?content=false', 4),
  ('Maven Clinic', 'mavenclinic', 'greenhouse', 'https://boards.greenhouse.io/mavenclinic', 'https://boards-api.greenhouse.io/v1/boards/mavenclinic/jobs?content=false', 5),
  ('Modern Health', 'modernhealth', 'greenhouse', 'https://boards.greenhouse.io/modernhealth', 'https://boards-api.greenhouse.io/v1/boards/modernhealth/jobs?content=false', 5),
  ('N26', 'n26', 'greenhouse', 'https://boards.greenhouse.io/n26', 'https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=false', 5),
  ('Reddit', 'reddit', 'greenhouse', 'https://boards.greenhouse.io/reddit', 'https://boards-api.greenhouse.io/v1/boards/reddit/jobs?content=false', 5),
  ('Robinhood', 'robinhood', 'greenhouse', 'https://boards.greenhouse.io/robinhood', 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=false', 5),
  ('Scale AI', 'scaleai', 'greenhouse', 'https://boards.greenhouse.io/scaleai', 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=false', 5),
  ('Toast', 'toast', 'greenhouse', 'https://boards.greenhouse.io/toast', 'https://boards-api.greenhouse.io/v1/boards/toast/jobs?content=false', 5),
  ('Workato', 'workato', 'greenhouse', 'https://boards.greenhouse.io/workato', 'https://boards-api.greenhouse.io/v1/boards/workato/jobs?content=false', 5),
  ('Yext', 'yext', 'greenhouse', 'https://boards.greenhouse.io/yext', 'https://boards-api.greenhouse.io/v1/boards/yext/jobs?content=false', 5),
  ('Zocdoc', 'zocdoc', 'greenhouse', 'https://boards.greenhouse.io/zocdoc', 'https://boards-api.greenhouse.io/v1/boards/zocdoc/jobs?content=false', 5),
  ('Zscaler', 'zscaler', 'greenhouse', 'https://boards.greenhouse.io/zscaler', 'https://boards-api.greenhouse.io/v1/boards/zscaler/jobs?content=false', 6),
  ('Branch', 'branch', 'greenhouse', 'https://boards.greenhouse.io/branch', 'https://boards-api.greenhouse.io/v1/boards/branch/jobs?content=false', 6),
  ('AssemblyAI', 'assemblyai', 'greenhouse', 'https://boards.greenhouse.io/assemblyai', 'https://boards-api.greenhouse.io/v1/boards/assemblyai/jobs?content=false', 6),
  ('Axonius', 'axonius', 'greenhouse', 'https://boards.greenhouse.io/axonius', 'https://boards-api.greenhouse.io/v1/boards/axonius/jobs?content=false', 6),
  ('Betterment', 'betterment', 'greenhouse', 'https://boards.greenhouse.io/betterment', 'https://boards-api.greenhouse.io/v1/boards/betterment/jobs?content=false', 6),
  ('Braze', 'braze', 'greenhouse', 'https://boards.greenhouse.io/braze', 'https://boards-api.greenhouse.io/v1/boards/braze/jobs?content=false', 6),
  ('Cloudflare', 'cloudflare', 'greenhouse', 'https://boards.greenhouse.io/cloudflare', 'https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=false', 6),
  ('Cockroach Labs', 'cockroachlabs', 'greenhouse', 'https://boards.greenhouse.io/cockroachlabs', 'https://boards-api.greenhouse.io/v1/boards/cockroachlabs/jobs?content=false', 6),
  ('Contentful', 'contentful', 'greenhouse', 'https://boards.greenhouse.io/contentful', 'https://boards-api.greenhouse.io/v1/boards/contentful/jobs?content=false', 6),
  ('Databricks', 'databricks', 'greenhouse', 'https://boards.greenhouse.io/databricks', 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=false', 6),
  ('EarnIn', 'earnin', 'greenhouse', 'https://boards.greenhouse.io/earnin', 'https://boards-api.greenhouse.io/v1/boards/earnin/jobs?content=false', 7),
  ('Klaviyo', 'klaviyo', 'greenhouse', 'https://boards.greenhouse.io/klaviyo', 'https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs?content=false', 7),
  ('Netskope', 'netskope', 'greenhouse', 'https://boards.greenhouse.io/netskope', 'https://boards-api.greenhouse.io/v1/boards/netskope/jobs?content=false', 7),
  ('Roku', 'roku', 'greenhouse', 'https://boards.greenhouse.io/roku', 'https://boards-api.greenhouse.io/v1/boards/roku/jobs?content=false', 7),
  ('Rubrik', 'rubrik', 'greenhouse', 'https://boards.greenhouse.io/rubrik', 'https://boards-api.greenhouse.io/v1/boards/rubrik/jobs?content=false', 7),
  ('Squarespace', 'squarespace', 'greenhouse', 'https://boards.greenhouse.io/squarespace', 'https://boards-api.greenhouse.io/v1/boards/squarespace/jobs?content=false', 7),
  ('Udemy', 'udemy', 'greenhouse', 'https://boards.greenhouse.io/udemy', 'https://boards-api.greenhouse.io/v1/boards/udemy/jobs?content=false', 7),
  ('Linear', 'linear', 'ashby', 'https://jobs.ashbyhq.com/linear', 'https://api.ashbyhq.com/posting-api/job-board/linear', 7),
  ('Cursor', 'cursor', 'ashby', 'https://jobs.ashbyhq.com/cursor', 'https://api.ashbyhq.com/posting-api/job-board/cursor', 7),
  ('Lovable', 'lovable', 'ashby', 'https://jobs.ashbyhq.com/lovable', 'https://api.ashbyhq.com/posting-api/job-board/lovable', 7),
  ('Notion', 'notion', 'ashby', 'https://jobs.ashbyhq.com/notion', 'https://api.ashbyhq.com/posting-api/job-board/notion', 8),
  ('Supabase', 'supabase', 'ashby', 'https://jobs.ashbyhq.com/supabase', 'https://api.ashbyhq.com/posting-api/job-board/supabase', 8),
  ('Posthog', 'posthog', 'ashby', 'https://jobs.ashbyhq.com/posthog', 'https://api.ashbyhq.com/posting-api/job-board/posthog', 8),
  ('Sentry', 'sentry', 'ashby', 'https://jobs.ashbyhq.com/sentry', 'https://api.ashbyhq.com/posting-api/job-board/sentry', 8),
  ('Plaid', 'plaid', 'ashby', 'https://jobs.ashbyhq.com/plaid', 'https://api.ashbyhq.com/posting-api/job-board/plaid', 8),
  ('Runway', 'runway', 'ashby', 'https://jobs.ashbyhq.com/runway', 'https://api.ashbyhq.com/posting-api/job-board/runway', 8),
  ('Cohere', 'cohere', 'ashby', 'https://jobs.ashbyhq.com/cohere', 'https://api.ashbyhq.com/posting-api/job-board/cohere', 8),
  ('ElevenLabs', 'elevenlabs', 'ashby', 'https://jobs.ashbyhq.com/elevenlabs', 'https://api.ashbyhq.com/posting-api/job-board/elevenlabs', 8),
  ('Replit', 'replit', 'ashby', 'https://jobs.ashbyhq.com/replit', 'https://api.ashbyhq.com/posting-api/job-board/replit', 8),
  ('Vanta', 'vanta', 'ashby', 'https://jobs.ashbyhq.com/vanta', 'https://api.ashbyhq.com/posting-api/job-board/vanta', 8),
  ('Snyk', 'snyk', 'ashby', 'https://jobs.ashbyhq.com/snyk', 'https://api.ashbyhq.com/posting-api/job-board/snyk', 9),
  ('Attio', 'attio', 'ashby', 'https://jobs.ashbyhq.com/attio', 'https://api.ashbyhq.com/posting-api/job-board/attio', 9),
  ('ClickHouse', 'clickhouse', 'ashby', 'https://jobs.ashbyhq.com/clickhouse', 'https://api.ashbyhq.com/posting-api/job-board/clickhouse', 9),
  ('Neon', 'neon', 'ashby', 'https://jobs.ashbyhq.com/neon', 'https://api.ashbyhq.com/posting-api/job-board/neon', 9),
  ('Temporal', 'temporal', 'ashby', 'https://jobs.ashbyhq.com/temporal', 'https://api.ashbyhq.com/posting-api/job-board/temporal', 9),
  ('Modal', 'modal', 'ashby', 'https://jobs.ashbyhq.com/modal', 'https://api.ashbyhq.com/posting-api/job-board/modal', 9),
  ('Baseten', 'baseten', 'ashby', 'https://jobs.ashbyhq.com/baseten', 'https://api.ashbyhq.com/posting-api/job-board/baseten', 9),
  ('Hightouch', 'hightouch', 'ashby', 'https://jobs.ashbyhq.com/hightouch', 'https://api.ashbyhq.com/posting-api/job-board/hightouch', 9),
  ('Pylon', 'pylon', 'ashby', 'https://jobs.ashbyhq.com/pylon', 'https://api.ashbyhq.com/posting-api/job-board/pylon', 9),
  ('Incident', 'incident', 'ashby', 'https://jobs.ashbyhq.com/incident', 'https://api.ashbyhq.com/posting-api/job-board/incident', 9),
  ('Railway', 'railway', 'ashby', 'https://jobs.ashbyhq.com/railway', 'https://api.ashbyhq.com/posting-api/job-board/railway', 10),
  ('Render', 'render', 'ashby', 'https://jobs.ashbyhq.com/render', 'https://api.ashbyhq.com/posting-api/job-board/render', 10),
  ('Docker', 'docker', 'ashby', 'https://jobs.ashbyhq.com/docker', 'https://api.ashbyhq.com/posting-api/job-board/docker', 10),
  ('Mux', 'mux', 'ashby', 'https://jobs.ashbyhq.com/mux', 'https://api.ashbyhq.com/posting-api/job-board/mux', 10),
  ('Resend', 'resend', 'ashby', 'https://jobs.ashbyhq.com/resend', 'https://api.ashbyhq.com/posting-api/job-board/resend', 10),
  ('Oyster', 'oyster', 'ashby', 'https://jobs.ashbyhq.com/oyster', 'https://api.ashbyhq.com/posting-api/job-board/oyster', 10),
  ('WorkOS', 'workos', 'ashby', 'https://jobs.ashbyhq.com/workos', 'https://api.ashbyhq.com/posting-api/job-board/workos', 10),
  ('Sardine', 'sardine', 'ashby', 'https://jobs.ashbyhq.com/sardine', 'https://api.ashbyhq.com/posting-api/job-board/sardine', 10),
  ('Airbyte', 'airbyte', 'ashby', 'https://jobs.ashbyhq.com/airbyte', 'https://api.ashbyhq.com/posting-api/job-board/airbyte', 10),
  ('Amplitude', 'amplitude', 'ashby', 'https://jobs.ashbyhq.com/amplitude', 'https://api.ashbyhq.com/posting-api/job-board/amplitude', 10)
)
insert into companies (name, slug, careers_url, verified)
select distinct on (lower(company_name)) company_name, board_identifier, career_url, true
from roster order by lower(company_name), activation_batch, board_identifier
on conflict (lower(name)) do nothing;

with roster(company_name, board_identifier, provider, career_url, feed_url, activation_batch) as (
values
  ('Stripe', 'stripe', 'greenhouse', 'https://boards.greenhouse.io/stripe', 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false', 1),
  ('Ramp', 'ramp', 'greenhouse', 'https://boards.greenhouse.io/ramp', 'https://boards-api.greenhouse.io/v1/boards/ramp/jobs?content=false', 1),
  ('Brex', 'brex', 'greenhouse', 'https://boards.greenhouse.io/brex', 'https://boards-api.greenhouse.io/v1/boards/brex/jobs?content=false', 1),
  ('Gusto', 'gusto', 'greenhouse', 'https://boards.greenhouse.io/gusto', 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=false', 1),
  ('Mercury', 'mercury', 'greenhouse', 'https://boards.greenhouse.io/mercury', 'https://boards-api.greenhouse.io/v1/boards/mercury/jobs?content=false', 1),
  ('Vercel', 'vercel', 'greenhouse', 'https://boards.greenhouse.io/vercel', 'https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=false', 1),
  ('Figma', 'figma', 'greenhouse', 'https://boards.greenhouse.io/figma', 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=false', 1),
  ('Anthropic', 'anthropic', 'greenhouse', 'https://boards.greenhouse.io/anthropic', 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=false', 1),
  ('Datadog', 'datadog', 'greenhouse', 'https://boards.greenhouse.io/datadog', 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=false', 1),
  ('Fivetran', 'fivetran', 'greenhouse', 'https://boards.greenhouse.io/fivetran', 'https://boards-api.greenhouse.io/v1/boards/fivetran/jobs?content=false', 1),
  ('Affirm', 'affirm', 'greenhouse', 'https://boards.greenhouse.io/affirm', 'https://boards-api.greenhouse.io/v1/boards/affirm/jobs?content=false', 2),
  ('Asana', 'asana', 'greenhouse', 'https://boards.greenhouse.io/asana', 'https://boards-api.greenhouse.io/v1/boards/asana/jobs?content=false', 2),
  ('Calendly', 'calendly', 'greenhouse', 'https://boards.greenhouse.io/calendly', 'https://boards-api.greenhouse.io/v1/boards/calendly/jobs?content=false', 2),
  ('Circleci', 'circleci', 'greenhouse', 'https://boards.greenhouse.io/circleci', 'https://boards-api.greenhouse.io/v1/boards/circleci/jobs?content=false', 2),
  ('Coinbase', 'coinbase', 'greenhouse', 'https://boards.greenhouse.io/coinbase', 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=false', 2),
  ('Elastic', 'elastic', 'greenhouse', 'https://boards.greenhouse.io/elastic', 'https://boards-api.greenhouse.io/v1/boards/elastic/jobs?content=false', 2),
  ('Faire', 'faire', 'greenhouse', 'https://boards.greenhouse.io/faire', 'https://boards-api.greenhouse.io/v1/boards/faire/jobs?content=false', 2),
  ('Fastly', 'fastly', 'greenhouse', 'https://boards.greenhouse.io/fastly', 'https://boards-api.greenhouse.io/v1/boards/fastly/jobs?content=false', 2),
  ('GitLab', 'gitlab', 'greenhouse', 'https://boards.greenhouse.io/gitlab', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=false', 2),
  ('Instacart', 'instacart', 'greenhouse', 'https://boards.greenhouse.io/instacart', 'https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=false', 2),
  ('ZipRecruiter', 'ziprecruiter', 'greenhouse', 'https://boards.greenhouse.io/ziprecruiter', 'https://boards-api.greenhouse.io/v1/boards/ziprecruiter/jobs?content=false', 3),
  ('Jamf', 'jamf', 'greenhouse', 'https://boards.greenhouse.io/jamf', 'https://boards-api.greenhouse.io/v1/boards/jamf/jobs?content=false', 3),
  ('Lyft', 'lyft', 'greenhouse', 'https://boards.greenhouse.io/lyft', 'https://boards-api.greenhouse.io/v1/boards/lyft/jobs?content=false', 3),
  ('Mixpanel', 'mixpanel', 'greenhouse', 'https://boards.greenhouse.io/mixpanel', 'https://boards-api.greenhouse.io/v1/boards/mixpanel/jobs?content=false', 3),
  ('Nuro', 'nuro', 'greenhouse', 'https://boards.greenhouse.io/nuro', 'https://boards-api.greenhouse.io/v1/boards/nuro/jobs?content=false', 3),
  ('Okta', 'okta', 'greenhouse', 'https://boards.greenhouse.io/okta', 'https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=false', 3),
  ('Oscar Health', 'oscar', 'greenhouse', 'https://boards.greenhouse.io/oscar', 'https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=false', 3),
  ('PagerDuty', 'pagerduty', 'greenhouse', 'https://boards.greenhouse.io/pagerduty', 'https://boards-api.greenhouse.io/v1/boards/pagerduty/jobs?content=false', 3),
  ('Pinterest', 'pinterest', 'greenhouse', 'https://boards.greenhouse.io/pinterest', 'https://boards-api.greenhouse.io/v1/boards/pinterest/jobs?content=false', 3),
  ('Samsara', 'samsara', 'greenhouse', 'https://boards.greenhouse.io/samsara', 'https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=false', 3),
  ('Block', 'block', 'greenhouse', 'https://boards.greenhouse.io/block', 'https://boards-api.greenhouse.io/v1/boards/block/jobs?content=false', 4),
  ('Twilio', 'twilio', 'greenhouse', 'https://boards.greenhouse.io/twilio', 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=false', 4),
  ('Upstart', 'upstart', 'greenhouse', 'https://boards.greenhouse.io/upstart', 'https://boards-api.greenhouse.io/v1/boards/upstart/jobs?content=false', 4),
  ('Waymo', 'waymo', 'greenhouse', 'https://boards.greenhouse.io/waymo', 'https://boards-api.greenhouse.io/v1/boards/waymo/jobs?content=false', 4),
  ('Airbnb', 'airbnb', 'greenhouse', 'https://boards.greenhouse.io/airbnb', 'https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=false', 4),
  ('Coursera', 'coursera', 'greenhouse', 'https://boards.greenhouse.io/coursera', 'https://boards-api.greenhouse.io/v1/boards/coursera/jobs?content=false', 4),
  ('Duolingo', 'duolingo', 'greenhouse', 'https://boards.greenhouse.io/duolingo', 'https://boards-api.greenhouse.io/v1/boards/duolingo/jobs?content=false', 4),
  ('Flexport', 'flexport', 'greenhouse', 'https://boards.greenhouse.io/flexport', 'https://boards-api.greenhouse.io/v1/boards/flexport/jobs?content=false', 4),
  ('Justworks', 'justworks', 'greenhouse', 'https://boards.greenhouse.io/justworks', 'https://boards-api.greenhouse.io/v1/boards/justworks/jobs?content=false', 4),
  ('Lattice', 'lattice', 'greenhouse', 'https://boards.greenhouse.io/lattice', 'https://boards-api.greenhouse.io/v1/boards/lattice/jobs?content=false', 4),
  ('Maven Clinic', 'mavenclinic', 'greenhouse', 'https://boards.greenhouse.io/mavenclinic', 'https://boards-api.greenhouse.io/v1/boards/mavenclinic/jobs?content=false', 5),
  ('Modern Health', 'modernhealth', 'greenhouse', 'https://boards.greenhouse.io/modernhealth', 'https://boards-api.greenhouse.io/v1/boards/modernhealth/jobs?content=false', 5),
  ('N26', 'n26', 'greenhouse', 'https://boards.greenhouse.io/n26', 'https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=false', 5),
  ('Reddit', 'reddit', 'greenhouse', 'https://boards.greenhouse.io/reddit', 'https://boards-api.greenhouse.io/v1/boards/reddit/jobs?content=false', 5),
  ('Robinhood', 'robinhood', 'greenhouse', 'https://boards.greenhouse.io/robinhood', 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=false', 5),
  ('Scale AI', 'scaleai', 'greenhouse', 'https://boards.greenhouse.io/scaleai', 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=false', 5),
  ('Toast', 'toast', 'greenhouse', 'https://boards.greenhouse.io/toast', 'https://boards-api.greenhouse.io/v1/boards/toast/jobs?content=false', 5),
  ('Workato', 'workato', 'greenhouse', 'https://boards.greenhouse.io/workato', 'https://boards-api.greenhouse.io/v1/boards/workato/jobs?content=false', 5),
  ('Yext', 'yext', 'greenhouse', 'https://boards.greenhouse.io/yext', 'https://boards-api.greenhouse.io/v1/boards/yext/jobs?content=false', 5),
  ('Zocdoc', 'zocdoc', 'greenhouse', 'https://boards.greenhouse.io/zocdoc', 'https://boards-api.greenhouse.io/v1/boards/zocdoc/jobs?content=false', 5),
  ('Zscaler', 'zscaler', 'greenhouse', 'https://boards.greenhouse.io/zscaler', 'https://boards-api.greenhouse.io/v1/boards/zscaler/jobs?content=false', 6),
  ('Branch', 'branch', 'greenhouse', 'https://boards.greenhouse.io/branch', 'https://boards-api.greenhouse.io/v1/boards/branch/jobs?content=false', 6),
  ('AssemblyAI', 'assemblyai', 'greenhouse', 'https://boards.greenhouse.io/assemblyai', 'https://boards-api.greenhouse.io/v1/boards/assemblyai/jobs?content=false', 6),
  ('Axonius', 'axonius', 'greenhouse', 'https://boards.greenhouse.io/axonius', 'https://boards-api.greenhouse.io/v1/boards/axonius/jobs?content=false', 6),
  ('Betterment', 'betterment', 'greenhouse', 'https://boards.greenhouse.io/betterment', 'https://boards-api.greenhouse.io/v1/boards/betterment/jobs?content=false', 6),
  ('Braze', 'braze', 'greenhouse', 'https://boards.greenhouse.io/braze', 'https://boards-api.greenhouse.io/v1/boards/braze/jobs?content=false', 6),
  ('Cloudflare', 'cloudflare', 'greenhouse', 'https://boards.greenhouse.io/cloudflare', 'https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=false', 6),
  ('Cockroach Labs', 'cockroachlabs', 'greenhouse', 'https://boards.greenhouse.io/cockroachlabs', 'https://boards-api.greenhouse.io/v1/boards/cockroachlabs/jobs?content=false', 6),
  ('Contentful', 'contentful', 'greenhouse', 'https://boards.greenhouse.io/contentful', 'https://boards-api.greenhouse.io/v1/boards/contentful/jobs?content=false', 6),
  ('Databricks', 'databricks', 'greenhouse', 'https://boards.greenhouse.io/databricks', 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=false', 6),
  ('EarnIn', 'earnin', 'greenhouse', 'https://boards.greenhouse.io/earnin', 'https://boards-api.greenhouse.io/v1/boards/earnin/jobs?content=false', 7),
  ('Klaviyo', 'klaviyo', 'greenhouse', 'https://boards.greenhouse.io/klaviyo', 'https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs?content=false', 7),
  ('Netskope', 'netskope', 'greenhouse', 'https://boards.greenhouse.io/netskope', 'https://boards-api.greenhouse.io/v1/boards/netskope/jobs?content=false', 7),
  ('Roku', 'roku', 'greenhouse', 'https://boards.greenhouse.io/roku', 'https://boards-api.greenhouse.io/v1/boards/roku/jobs?content=false', 7),
  ('Rubrik', 'rubrik', 'greenhouse', 'https://boards.greenhouse.io/rubrik', 'https://boards-api.greenhouse.io/v1/boards/rubrik/jobs?content=false', 7),
  ('Squarespace', 'squarespace', 'greenhouse', 'https://boards.greenhouse.io/squarespace', 'https://boards-api.greenhouse.io/v1/boards/squarespace/jobs?content=false', 7),
  ('Udemy', 'udemy', 'greenhouse', 'https://boards.greenhouse.io/udemy', 'https://boards-api.greenhouse.io/v1/boards/udemy/jobs?content=false', 7),
  ('Linear', 'linear', 'ashby', 'https://jobs.ashbyhq.com/linear', 'https://api.ashbyhq.com/posting-api/job-board/linear', 7),
  ('Cursor', 'cursor', 'ashby', 'https://jobs.ashbyhq.com/cursor', 'https://api.ashbyhq.com/posting-api/job-board/cursor', 7),
  ('Lovable', 'lovable', 'ashby', 'https://jobs.ashbyhq.com/lovable', 'https://api.ashbyhq.com/posting-api/job-board/lovable', 7),
  ('Notion', 'notion', 'ashby', 'https://jobs.ashbyhq.com/notion', 'https://api.ashbyhq.com/posting-api/job-board/notion', 8),
  ('Supabase', 'supabase', 'ashby', 'https://jobs.ashbyhq.com/supabase', 'https://api.ashbyhq.com/posting-api/job-board/supabase', 8),
  ('Posthog', 'posthog', 'ashby', 'https://jobs.ashbyhq.com/posthog', 'https://api.ashbyhq.com/posting-api/job-board/posthog', 8),
  ('Sentry', 'sentry', 'ashby', 'https://jobs.ashbyhq.com/sentry', 'https://api.ashbyhq.com/posting-api/job-board/sentry', 8),
  ('Plaid', 'plaid', 'ashby', 'https://jobs.ashbyhq.com/plaid', 'https://api.ashbyhq.com/posting-api/job-board/plaid', 8),
  ('Runway', 'runway', 'ashby', 'https://jobs.ashbyhq.com/runway', 'https://api.ashbyhq.com/posting-api/job-board/runway', 8),
  ('Cohere', 'cohere', 'ashby', 'https://jobs.ashbyhq.com/cohere', 'https://api.ashbyhq.com/posting-api/job-board/cohere', 8),
  ('ElevenLabs', 'elevenlabs', 'ashby', 'https://jobs.ashbyhq.com/elevenlabs', 'https://api.ashbyhq.com/posting-api/job-board/elevenlabs', 8),
  ('Replit', 'replit', 'ashby', 'https://jobs.ashbyhq.com/replit', 'https://api.ashbyhq.com/posting-api/job-board/replit', 8),
  ('Vanta', 'vanta', 'ashby', 'https://jobs.ashbyhq.com/vanta', 'https://api.ashbyhq.com/posting-api/job-board/vanta', 8),
  ('Snyk', 'snyk', 'ashby', 'https://jobs.ashbyhq.com/snyk', 'https://api.ashbyhq.com/posting-api/job-board/snyk', 9),
  ('Attio', 'attio', 'ashby', 'https://jobs.ashbyhq.com/attio', 'https://api.ashbyhq.com/posting-api/job-board/attio', 9),
  ('ClickHouse', 'clickhouse', 'ashby', 'https://jobs.ashbyhq.com/clickhouse', 'https://api.ashbyhq.com/posting-api/job-board/clickhouse', 9),
  ('Neon', 'neon', 'ashby', 'https://jobs.ashbyhq.com/neon', 'https://api.ashbyhq.com/posting-api/job-board/neon', 9),
  ('Temporal', 'temporal', 'ashby', 'https://jobs.ashbyhq.com/temporal', 'https://api.ashbyhq.com/posting-api/job-board/temporal', 9),
  ('Modal', 'modal', 'ashby', 'https://jobs.ashbyhq.com/modal', 'https://api.ashbyhq.com/posting-api/job-board/modal', 9),
  ('Baseten', 'baseten', 'ashby', 'https://jobs.ashbyhq.com/baseten', 'https://api.ashbyhq.com/posting-api/job-board/baseten', 9),
  ('Hightouch', 'hightouch', 'ashby', 'https://jobs.ashbyhq.com/hightouch', 'https://api.ashbyhq.com/posting-api/job-board/hightouch', 9),
  ('Pylon', 'pylon', 'ashby', 'https://jobs.ashbyhq.com/pylon', 'https://api.ashbyhq.com/posting-api/job-board/pylon', 9),
  ('Incident', 'incident', 'ashby', 'https://jobs.ashbyhq.com/incident', 'https://api.ashbyhq.com/posting-api/job-board/incident', 9),
  ('Railway', 'railway', 'ashby', 'https://jobs.ashbyhq.com/railway', 'https://api.ashbyhq.com/posting-api/job-board/railway', 10),
  ('Render', 'render', 'ashby', 'https://jobs.ashbyhq.com/render', 'https://api.ashbyhq.com/posting-api/job-board/render', 10),
  ('Docker', 'docker', 'ashby', 'https://jobs.ashbyhq.com/docker', 'https://api.ashbyhq.com/posting-api/job-board/docker', 10),
  ('Mux', 'mux', 'ashby', 'https://jobs.ashbyhq.com/mux', 'https://api.ashbyhq.com/posting-api/job-board/mux', 10),
  ('Resend', 'resend', 'ashby', 'https://jobs.ashbyhq.com/resend', 'https://api.ashbyhq.com/posting-api/job-board/resend', 10),
  ('Oyster', 'oyster', 'ashby', 'https://jobs.ashbyhq.com/oyster', 'https://api.ashbyhq.com/posting-api/job-board/oyster', 10),
  ('WorkOS', 'workos', 'ashby', 'https://jobs.ashbyhq.com/workos', 'https://api.ashbyhq.com/posting-api/job-board/workos', 10),
  ('Sardine', 'sardine', 'ashby', 'https://jobs.ashbyhq.com/sardine', 'https://api.ashbyhq.com/posting-api/job-board/sardine', 10),
  ('Airbyte', 'airbyte', 'ashby', 'https://jobs.ashbyhq.com/airbyte', 'https://api.ashbyhq.com/posting-api/job-board/airbyte', 10),
  ('Amplitude', 'amplitude', 'ashby', 'https://jobs.ashbyhq.com/amplitude', 'https://api.ashbyhq.com/posting-api/job-board/amplitude', 10)
)
insert into company_sources (company_id, provider, board_identifier, source_url, is_active, activation_batch, activated_at)
select c.id, r.provider::ats_provider, r.board_identifier, r.career_url,
       r.activation_batch = 1,
       r.activation_batch,
       case when r.activation_batch = 1 then now() else null end
from roster r
join companies c on lower(c.name) = lower(r.company_name)
on conflict (provider, board_identifier) do nothing;

create or replace function activate_next_company_source_batch()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_batch smallint;
  changed integer;
begin
  -- Serialize concurrent FETCH/cron calls and advance at most one batch per 7 days.
  perform pg_advisory_xact_lock(hashtext('company-source-weekly-activation'));
  select active_batch into next_batch
    from company_source_activation_state where id = true for update;
  if next_batch is null or next_batch >= 10 then return 0; end if;
  if not exists (
    select 1 from company_source_activation_state
    where id = true and last_activated_at <= now() - interval '7 days'
  ) then return 0; end if;
  next_batch := next_batch + 1;
  update company_sources
     set is_active = true, activated_at = now(), updated_at = now()
   where activation_batch = next_batch and not is_active;
  get diagnostics changed = row_count;
  update company_source_activation_state
     set active_batch = next_batch, last_activated_at = now(), updated_at = now()
   where id = true;
  return changed;
end;
$$;
revoke all on function activate_next_company_source_batch() from public, anon, authenticated;
grant execute on function activate_next_company_source_batch() to service_role;
