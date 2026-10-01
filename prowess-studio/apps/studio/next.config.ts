import type { NextConfig } from "next";
import { EnvironmentConfigError, validateEnv } from "./src/config";

// Fail fast, with a readable multi-line error, before Next.js does anything
// else — rather than surfacing a confusing runtime error the first time a
// route touches a missing/invalid environment variable. See PAS-10 §9
// (M0-WO2, "Application should fail clearly when mandatory configuration is
// missing"). Next.js has already loaded the appropriate .env.$(NODE_ENV)
// file into process.env by the time this file is evaluated — we only need
// to validate what's there, not load it ourselves.
try {
  validateEnv(process.env);
} catch (error) {
  if (error instanceof EnvironmentConfigError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @prowess/model and @prowess/ui are workspace TypeScript packages
  // published as plain source-adjacent builds; transpile them through
  // Next's own pipeline rather than requiring each package to pre-build
  // a Next-compatible bundle.
  transpilePackages: ["@prowess/model", "@prowess/ui"],
};

export default nextConfig;
