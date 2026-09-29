-- pg_cron Setup for Neon → Supabase Mirror
-- Run this ONCE on your Neon database (via psql or Neon SQL Editor)
-- This creates the mirror function and schedules it every 30 minutes

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS dblink;

-- 2. Create the mirror function
-- NOTE: Replace the connection string with your actual Supabase connection
-- Get this from Supabase Dashboard → Settings → Database → Connection pooling (Session mode, port 5432)
CREATE OR REPLACE FUNCTION mirror_to_supabase()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  -- REPLACE WITH YOUR ACTUAL SUPABASE CONNECTION STRING
  -- Format: host=db.xxx.supabase.co port=5432 dbname=postgres user=postgres password=xxx sslmode=require
  supabase_conn text := 'host=db.xxx.supabase.co port=5432 dbname=postgres user=postgres password=YOUR_PASSWORD sslmode=require';
  
  tables_to_mirror text[] := ARRAY[
    -- Core tenancy
    'tenant', 'school',
    -- Academic structure
    'academic_year', 'term', 'class_level', 'class',
    'subject', 'subject_level', 'class_subject',
    -- Grading & assessment
    'grading_scale', 'grading_level', 'assessment_type_config',
    -- Finance
    'fee_category', 'payment_method_config',
    -- RBAC
    'role', 'permission', 'delegation', 'attendance_taker',
    -- CMS
    'news', 'event', 'report_template', 'branding',
    -- Data
    'staff', 'student', 'enrollment', 'assessment', 'score',
    'attendance_student', 'attendance_staff', 'fee_invoice', 'payment',
    -- Communication
    'message', 'notification',
    -- Audit
    'audit_log'
  ];
  tbl text;
  cols text;
BEGIN
  -- For each table, use COPY TO/FROM for efficient bulk sync
  FOREACH tbl IN ARRAY tables_to_mirror LOOP
    -- Get column names (exclude auto-generated columns)
    SELECT string_agg(column_name, ', ') INTO cols
    FROM information_schema.columns
    WHERE table_name = tbl 
      AND column_default IS NULL 
      AND is_identity = 'NO';
    
    IF cols IS NULL OR cols = '' THEN
      cols := '*';
    END IF;
    
    -- Execute COPY from Neon to Supabase
    -- TRUNCATE CASCADE on Supabase first, then COPY data
    EXECUTE format(
      'COPY (SELECT %s FROM %I) TO PROGRAM ''psql "%s" -c "TRUNCATE %I CASCADE; COPY %I (%s) FROM STDIN"''',
      cols, tbl, supabase_conn, tbl, tbl, cols
    );
  END LOOP;
END;
$$;

-- 3. Schedule the mirror job (every 30 minutes)
-- This runs inside Neon's compute (counts toward 190 hrs/mo free tier)
SELECT cron.schedule('mirror-to-supabase', '*/30 * * * *', 'SELECT mirror_to_supabase()');

-- 4. Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'mirror-to-supabase';

-- 5. View job run history (run after some executions)
-- SELECT * FROM cron.job_run_details WHERE jobname = 'mirror-to-supabase' ORDER BY start_time DESC LIMIT 10;

-- 6. To unschedule (if needed):
-- SELECT cron.unschedule('mirror-to-supabase');

-- 7. To manually trigger a mirror run:
-- SELECT mirror_to_supabase();