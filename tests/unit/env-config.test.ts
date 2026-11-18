import { describe, expect, it } from 'vitest';
import { configurationReport } from '../../src/lib/env';
import { testEnv } from '../helpers';

describe('configurationReport', () => {
  it('reports auth as configured when only the service-role key is present', () => {
    const report = configurationReport(
      testEnv({
        supabaseUrl: 'https://project.supabase.co',
        supabaseAnonKey: null,
        supabaseServiceRoleKey: 'service-key',
      }),
    );
    expect(report.auth).toBe(true);
    expect(report.database).toBe(true);
  });

  it('reports auth as configured when the anon key is present', () => {
    const report = configurationReport(
      testEnv({
        supabaseUrl: 'https://project.supabase.co',
        supabaseAnonKey: 'anon-key',
        supabaseServiceRoleKey: null,
      }),
    );
    expect(report.auth).toBe(true);
    expect(report.database).toBe(false);
  });

  it('reports auth as unavailable without a Supabase URL or any key', () => {
    expect(configurationReport(testEnv()).auth).toBe(false);
    expect(
      configurationReport(testEnv({ supabaseUrl: 'https://project.supabase.co' })).auth,
    ).toBe(false);
  });

  it('enables direct LinkedIn retrieval only when both flags are set', () => {
    const off = configurationReport(testEnv({ linkedinJsonLdEnabled: true }));
    expect(off.linkedinRetrieval).toBe('disabled');

    const on = configurationReport(
      testEnv({ linkedinJsonLdEnabled: true, linkedinRetrievalAuthorised: true }),
    );
    expect(on.linkedinRetrieval).toBe('jsonld');
  });
});
