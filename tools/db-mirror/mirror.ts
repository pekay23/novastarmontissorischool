#!/usr/bin/env bun
/**
 * Neon → Supabase Database Mirror
 * Uses pg_cron on Neon for scheduling (zero GitHub Actions minutes)
 * This script is run manually or via pg_cron function on Neon
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load SUPABASE_DATABASE_URL from .env.local if present
const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^SUPABASE_DATABASE_URL=(.+)$/);
    if (match) {
      process.env.SUPABASE_DATABASE_URL = match[1].replace(/^["']|["']$/g, "");
    }
  }
}

const neonUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_DATABASE_URL;

if (!neonUrl) {
  console.error("ERROR: DATABASE_URL (Neon) is not set.");
  process.exit(1);
}

if (!supabaseUrl) {
  console.error("ERROR: SUPABASE_DATABASE_URL is not set.");
  console.error("Set it in .env.local or export it before running this script.");
  process.exit(1);
}

console.log("Mirroring Neon → Supabase...");
console.log(`Source: ${neonUrl.split("@")[0]}@****`);
console.log(`Target: ${supabaseUrl.split("@")[0]}@****`);

// Ensure sslmode=require for Supabase
let supabasePushUrl = supabaseUrl;
if (!supabasePushUrl.includes("sslmode=")) {
  supabasePushUrl += supabasePushUrl.includes("?") ? "&sslmode=require" : "?sslmode=require";
}

// Use session pooler (port 5432) for DDL operations
supabasePushUrl = supabasePushUrl.replace(":6543/", ":5432/");

// Tables to mirror (in dependency order)
const tablesToMirror = [
  // Core tenancy
  "tenant",
  "school",
  // Academic structure
  "academic_year",
  "term",
  "class_level",
  "class",
  "subject",
  "subject_level",
  "class_subject",
  // Grading & assessment
  "grading_scale",
  "grading_level",
  "assessment_type_config",
  // Finance
  "fee_category",
  "payment_method_config",
  // RBAC
  "role",
  "permission",
  "delegation",
  "attendance_taker",
  // CMS
  "news",
  "event",
  "report_template",
  "branding",
  // Data
  "staff",
  "student",
  "enrollment",
  "assessment",
  "score",
  "attendance_student",
  "attendance_staff",
  "fee_invoice",
  "payment",
  // Communication
  "message",
  "notification",
  // Audit
  "audit_log",
];

async function mirrorTable(table: string): Promise<void> {
  console.log(`\nMirroring ${table}...`);
  
  try {
    // Get column names (excluding auto-generated)
    const columnsResult = execSync(
      `psql "${neonUrl}" -t -c "SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE table_name = '${table}' AND column_default IS NULL AND is_identity = 'NO';"`,
      { encoding: "utf-8" }
    );
    const columns = columnsResult.trim() || "*";

    // COPY from Neon to Supabase
    const copyCommand = `COPY (SELECT ${columns} FROM ${table}) TO PROGRAM 'psql "${supabasePushUrl}" -c "TRUNCATE ${table} CASCADE; COPY ${table} (${columns}) FROM STDIN"'`;
    
    execSync(`psql "${neonUrl}" -c "${copyCommand}"`, { 
      stdio: "inherit",
      timeout: 60000 
    });
    
    console.log(`✓ ${table} mirrored successfully`);
  } catch (error) {
    console.error(`✗ Failed to mirror ${table}:`, error);
    throw error;
  }
}

async function main() {
  const startTime = Date.now();
  
  try {
    for (const table of tablesToMirror) {
      await mirrorTable(table);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Mirror completed in ${duration}s`);
    
    // Verify row counts
    console.log("\nVerifying row counts...");
    for (const table of tablesToMirror) {
      try {
        const [neonCount, supabaseCount] = await Promise.all([
          execSync(`psql "${neonUrl}" -t -c "SELECT count(*) FROM ${table};"`, { encoding: "utf-8" }),
          execSync(`psql "${supabasePushUrl}" -t -c "SELECT count(*) FROM ${table};"`, { encoding: "utf-8" }),
        ]);
        
        const nCount = parseInt(neonCount.trim());
        const sCount = parseInt(supabaseCount.trim());
        const match = nCount === sCount ? "✓" : "✗ MISMATCH";
        console.log(`  ${table}: Neon=${nCount}, Supabase=${sCount} ${match}`);
      } catch {
        console.log(`  ${table}: Could not verify`);
      }
    }
  } catch (error) {
    console.error("\n❌ Mirror failed");
    process.exit(1);
  }
}

main();