-- class_slots: every "show active classes for batch X" query uses both columns
CREATE INDEX IF NOT EXISTS idx_class_slots_batch_status
  ON public.class_slots (batch_id, status);

-- scheduled_notifications: the notification-batch-processor queries
-- WHERE status = 'PENDING' AND scheduled_for <= now()
-- A partial index on pending rows ordered by schedule time eliminates a full scan.
CREATE INDEX IF NOT EXISTS idx_scheduled_notif_pending_due
  ON public.scheduled_notifications (scheduled_for ASC)
  WHERE status = 'PENDING';

-- teacher_availability: prevent duplicate slot entries per teacher per batch
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_avail_time_slot
  ON public.teacher_availability (teacher_id, batch_id, day, time_slot)
  WHERE time_slot IS NOT NULL AND batch_id IS NOT NULL AND day IS NOT NULL;

COMMENT ON INDEX public.idx_class_slots_batch_status IS
  'Supports batch class management views filtering by batch and slot status.';
COMMENT ON INDEX public.idx_scheduled_notif_pending_due IS
  'Partial index for notification-batch-processor main query. Excludes sent/failed rows.';
