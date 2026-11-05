-- Phase 1c/2b (docs/53): retire stale in_progress routes and reconcile
-- the closeRoute residue. Both statements are idempotent and reversible.
--
-- 1) A driver must have exactly one active plan: supersede any in_progress
--    route older than the driver's newest non-draft plan. (v121 for Tom and
--    Mo is the live instance of this defect.)
UPDATE "routes"
SET status = 'superseded'
WHERE status = 'in_progress'
  AND version < (
    SELECT max(version) FROM "routes" r2
    WHERE r2.driver_id = "routes".driver_id
      AND r2.status IN ('published', 'in_progress', 'completed')
  );

-- 2) closeRoute residue: stops left pending although their job completed
--    (J-191 dropoff, J-202 pickup). The arrival timestamp is the best
--    available completion evidence; preserve it.
UPDATE "job_stops" js
SET status = 'completed', completed_at = js.arrived_at
FROM "jobs" j
WHERE j.id = js.job_id
  AND js.status = 'pending'
  AND js.arrived_at IS NOT NULL
  AND j.status = 'completed';
