-- Stage 1: extracted verbatim in purpose from former API startup DDL.
-- MANUAL REVIEW REQUIRED. This file is never executed by application startup.
-- First inspect the target schema and confirm the public schema is the intended schema.
-- Existing columns are left unchanged, including their types and constraints.
-- No users/metrics definitions are inferred from the incomplete schema.sql snapshot.
-- Rehearse only on an explicitly isolated database; production execution is not authorized.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.stations
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
COMMIT;
