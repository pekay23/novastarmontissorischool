-- Column-level parity DDL: adds columns present in the primary and absent
-- from the failsafe. Run AFTER failsafe-parity.sql (User.status needs the
-- "UserStatus" enum it creates) and BEFORE re-running tools/db-mirror/mirror.ts.
--
-- Generated from live information_schema by gen-column-parity-ddl.ts.
-- Verified with check-column-parity.ts.


