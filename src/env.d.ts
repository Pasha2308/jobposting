/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    runtime?: {
      env?: Record<string, string | undefined>;
      cf?: unknown;
      ctx?: unknown;
    };
    env: import('./lib/env').AppEnv;
    admin?: import('./lib/domain/types').AdminProfile;
    adminUserId?: string;
  }
}
