-- SQUASHED BASELINE (replaces migrations 001_ through 006_)
-- Generated: 2026-05-18
-- Source migrations: 001_initial_schema.sql, 002_seed_data.sql, 003_rls_policies.sql, 004_batch_management.sql, 005_add_applicants_availability.sql, 006_notification_system.sql
-- DO NOT apply this file to an existing database. Use only for fresh setup.
-- Existing databases already have these migrations applied individually.


-- ===== BEGIN 001_initial_schema.sql =====

-- =============================================================
-- 001_initial_schema.sql
-- Supabase / PostgreSQL initial schema for Foundation School
-- Migrated from: Google Apps Script + Google Sheets system
-- Groups: CE (Central East), CS (Central South), WS (West)
-- =============================================================


-- =============================================================
-- UTILITY: auto-update updated_at on every row change
-- =============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================
-- LEVEL 0: Foundation tables — no foreign key dependencies
-- =============================================================

-- ── config ───────────────────────────────────────────────────
-- Replaces: CONFIG sheet
CREATE TABLE config (
  key        TEXT        PRIMARY KEY,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE config IS
  'Replaces: CONFIG sheet. Key/value system configuration (form IDs, feature flags, timezone settings).';

CREATE TRIGGER trg_config_updated_at
  BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── fellowship_map ───────────────────────────────────────────
-- Replaces: FELLOWSHIP_MAP sheet
CREATE TABLE fellowship_map (
  fellowship_code TEXT        PRIMARY KEY,
  campus_name     TEXT        NOT NULL,
  group_id        TEXT        NOT NULL,   -- CE | CS | WS
  subgroup_id     TEXT        NOT NULL,   -- e.g. CESGA, CESGB, CSGA, WSGA
  active          BOOLEAN     NOT NULL DEFAULT true,
  timezone        TEXT        NOT NULL DEFAULT 'America/Toronto',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_fellowship_map_group_id CHECK (group_id IN ('CE', 'CS', 'WS'))
);
COMMENT ON TABLE fellowship_map IS
  'Replaces: FELLOWSHIP_MAP sheet. Maps campus codes (e.g. CMU, YORK) to group (CE/CS/WS) and subgroup.';

CREATE INDEX idx_fellowship_map_group_id    ON fellowship_map (group_id);
CREATE INDEX idx_fellowship_map_subgroup_id ON fellowship_map (subgroup_id);

CREATE TRIGGER trg_fellowship_map_updated_at
  BEFORE UPDATE ON fellowship_map
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── teachers ─────────────────────────────────────────────────
-- Replaces: TEACHERS sheet
CREATE TABLE teachers (
  teacher_id  TEXT        PRIMARY KEY,   -- preserved text ID from Apps Script
  full_name   TEXT        NOT NULL,
  email       TEXT,
  phone       TEXT,
  group_id    TEXT,
  subgroup_id TEXT,
  active      BOOLEAN     NOT NULL DEFAULT true,
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,               -- soft delete: non-null means removed
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE teachers IS
  'Replaces: TEACHERS sheet. Teacher records; soft-deleted via deleted_at.';

CREATE INDEX idx_teachers_email       ON teachers (email);
CREATE INDEX idx_teachers_group_id    ON teachers (group_id);
CREATE INDEX idx_teachers_not_deleted ON teachers (teacher_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── email_templates ──────────────────────────────────────────
-- Replaces: EMAIL_TEMPLATES sheet
CREATE TABLE email_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT        NOT NULL UNIQUE,
  subject      TEXT        NOT NULL,
  body_html    TEXT,
  body_text    TEXT,
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE email_templates IS
  'Replaces: EMAIL_TEMPLATES sheet. Reusable email templates keyed by template_key.';

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── sync_log ─────────────────────────────────────────────────
-- Replaces: SYNC_LOG sheet
CREATE TABLE sync_log (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  phase     TEXT,
  message   TEXT,
  details   JSONB,
  run_by    TEXT
);
COMMENT ON TABLE sync_log IS
  'Replaces: SYNC_LOG sheet. Operational log of automated sync/trigger runs.';

CREATE INDEX idx_sync_log_phase     ON sync_log (phase);
CREATE INDEX idx_sync_log_logged_at ON sync_log (logged_at DESC);


-- ── audit_log ────────────────────────────────────────────────
-- Replaces: AUDIT_LOG sheet
CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT        NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before_data JSONB,
  after_data  JSONB,
  notes       TEXT,
  changed_by  TEXT
);
COMMENT ON TABLE audit_log IS
  'Replaces: AUDIT_LOG sheet. Tracks before/after state for entity changes (auditing).';

CREATE INDEX idx_audit_log_entity_type ON audit_log (entity_type);
CREATE INDEX idx_audit_log_entity_id   ON audit_log (entity_id);


-- ── elvanto_import ───────────────────────────────────────────
-- Replaces: ELVANTO_IMPORT sheet
-- Staging table for members imported from Elvanto CRM before promotion to ft_pipeline.
CREATE TABLE elvanto_import (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                      TEXT        NOT NULL,
  full_name                  TEXT,
  date_added                 DATE,
  processed_to_eligible_pool BOOLEAN     NOT NULL DEFAULT false,
  imported_date              TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE elvanto_import IS
  'Replaces: ELVANTO_IMPORT sheet. Staging for Elvanto CRM member imports before ft_pipeline promotion.';

CREATE INDEX idx_elvanto_import_email     ON elvanto_import (email);
CREATE INDEX idx_elvanto_import_processed ON elvanto_import (processed_to_eligible_pool);

CREATE TRIGGER trg_elvanto_import_updated_at
  BEFORE UPDATE ON elvanto_import
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── batches ──────────────────────────────────────────────────
-- NEW: Foundation School cohort/batch table.
-- Must be created before all tables that carry batch_id so FK constraints resolve.
CREATE TABLE batches (
  batch_id          TEXT        PRIMARY KEY,   -- preserved text ID (e.g. '2025A', 'B3')
  name              TEXT,
  start_sunday      DATE,
  start_date        DATE,
  end_date          DATE,
  registration_open BOOLEAN     NOT NULL DEFAULT false,
  active            BOOLEAN     NOT NULL DEFAULT true,
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_batches_dates
    CHECK (start_date IS NULL OR start_sunday IS NULL OR start_date >= start_sunday)
);
COMMENT ON TABLE batches IS
  'NEW: Foundation School cohort/batch records. batch_id is the preserved text ID used throughout the Apps Script system.';

CREATE INDEX idx_batches_active ON batches (active);

CREATE TRIGGER trg_batches_updated_at
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================
-- LEVEL 1: Depends on teachers / batches
-- =============================================================

-- ── class_options ────────────────────────────────────────────
-- Replaces: CLASS_OPTIONS sheet
-- class_option_id = preserved text PK for this scheduled offering row
-- class_id        = curriculum/class label (e.g. the ClassID in Apps Script forms)
--                   Multiple class_options rows can share the same class_id
--                   (different time slots for the same curriculum unit).
CREATE TABLE class_options (
  class_option_id  TEXT        PRIMARY KEY,   -- preserved text ID from Apps Script
  class_id         TEXT        NOT NULL,       -- curriculum label (ClassID in Apps Script)
  teacher_id       TEXT        REFERENCES teachers(teacher_id)
                               ON DELETE SET NULL,
  teacher_name     TEXT,
  fellowship_codes TEXT[]      NOT NULL DEFAULT '{}',  -- e.g. '{CMU,YORK}'
  group_id         TEXT        NOT NULL,
  subgroup_id      TEXT        NOT NULL,
  day              TEXT,                -- e.g. 'Monday'
  class_time       TIME,
  active           BOOLEAN     NOT NULL DEFAULT false,
  enrollment_open  BOOLEAN     NOT NULL DEFAULT false,
  max_capacity     INTEGER,
  label_suffix     TEXT,                -- appended to teacher/time label in registration forms
  deleted_at       TIMESTAMPTZ,         -- soft delete
  created_by       TEXT,
  updated_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE class_options IS
  'Replaces: CLASS_OPTIONS sheet. Scheduled class offerings; class_option_id is the row PK, class_id is the curriculum label.';

CREATE INDEX idx_class_options_class_id         ON class_options (class_id);
CREATE INDEX idx_class_options_teacher_id       ON class_options (teacher_id);
CREATE INDEX idx_class_options_group_id         ON class_options (group_id);
CREATE INDEX idx_class_options_subgroup_id      ON class_options (subgroup_id);
CREATE INDEX idx_class_options_active           ON class_options (active);
CREATE INDEX idx_class_options_enrollment_open  ON class_options (enrollment_open);
CREATE INDEX idx_class_options_fellowship_codes ON class_options USING gin (fellowship_codes);
CREATE INDEX idx_class_options_not_deleted      ON class_options (class_option_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_class_options_updated_at
  BEFORE UPDATE ON class_options
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── form_sections ────────────────────────────────────────────
-- Replaces: FORM_SECTIONS sheet
CREATE TABLE form_sections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  section_title    TEXT        NOT NULL,
  question_title   TEXT,
  fellowship_codes TEXT[]      NOT NULL DEFAULT '{}',
  group_id         TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE form_sections IS
  'Replaces: FORM_SECTIONS sheet. Campus-based sections within group registration forms, rebuilt automatically.';

CREATE INDEX idx_form_sections_group_id ON form_sections (group_id);

CREATE TRIGGER trg_form_sections_updated_at
  BEFORE UPDATE ON form_sections
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================
-- LEVEL 2: Depends on class_options / fellowship_map / batches
-- =============================================================

-- ── class_slots ──────────────────────────────────────────────
-- Replaces: CLASS_SLOTS sheet
-- Running batch instances of class_options; tracks enrolment and status per batch.
CREATE TABLE class_slots (
  class_slot_id   TEXT        PRIMARY KEY,
  class_option_id TEXT        REFERENCES class_options(class_option_id)
                              ON DELETE RESTRICT,
  teacher_id      TEXT        REFERENCES teachers(teacher_id)
                              ON DELETE SET NULL,
  teacher_name    TEXT,
  group_id        TEXT        NOT NULL,
  subgroup_id     TEXT        NOT NULL,
  batch_id        TEXT        NOT NULL
                  REFERENCES batches(batch_id)
                  ON DELETE RESTRICT,
  status          TEXT        NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active', 'Closed', 'Cancelled')),
  current_enrolment INTEGER   NOT NULL DEFAULT 0,
  max_capacity    INTEGER,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE class_slots IS
  'Replaces: CLASS_SLOTS sheet. Running class instances per batch; tracks enrolment count and status.';

CREATE INDEX idx_class_slots_class_option_id ON class_slots (class_option_id);
CREATE INDEX idx_class_slots_teacher_id      ON class_slots (teacher_id);
CREATE INDEX idx_class_slots_group_id        ON class_slots (group_id);
CREATE INDEX idx_class_slots_batch_id        ON class_slots (batch_id);
CREATE INDEX idx_class_slots_status          ON class_slots (status);

CREATE TRIGGER trg_class_slots_updated_at
  BEFORE UPDATE ON class_slots
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── applicants ───────────────────────────────────────────────
-- Replaces: APPLICANTS sheet
-- Phase 1 registration form submissions.
CREATE TABLE applicants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        TEXT        NOT NULL,
  last_name         TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  phone             TEXT,
  fellowship_code   TEXT        REFERENCES fellowship_map(fellowship_code)
                                ON DELETE RESTRICT,
  group_id          TEXT,
  class_option_id   TEXT        REFERENCES class_options(class_option_id)
                                ON DELETE SET NULL,
  born_again        TEXT,         -- 'Yes' | 'No' | "I'm don't know"
  speaks_in_tongues TEXT,         -- 'Yes' | 'No' | "I'm not sure"
  water_baptized    TEXT,         -- 'Yes' | 'No'
  status            TEXT        NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Enrolled')),
  submitted_at      TIMESTAMPTZ,
  created_by        TEXT,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE applicants IS
  'Replaces: APPLICANTS sheet. Phase 1 intake form submissions; source of truth for registered applicants.';

CREATE INDEX idx_applicants_email             ON applicants (email);
CREATE INDEX idx_applicants_fellowship_code   ON applicants (fellowship_code);
CREATE INDEX idx_applicants_group_id          ON applicants (group_id);
CREATE INDEX idx_applicants_class_option_id   ON applicants (class_option_id);
CREATE INDEX idx_applicants_status            ON applicants (status);
CREATE UNIQUE INDEX uq_applicants_email_pending ON applicants (email) WHERE status = 'Pending';

CREATE TRIGGER trg_applicants_updated_at
  BEFORE UPDATE ON applicants
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── teacher_availability ─────────────────────────────────────
-- NEW: teacher scheduling availability per batch/offering.
-- Drives the teacher-availability scheduling UI (ui/teacher-availability/).
CREATE TABLE teacher_availability (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      TEXT        NOT NULL
                  REFERENCES teachers(teacher_id)
                  ON DELETE RESTRICT,
  class_option_id TEXT        REFERENCES class_options(class_option_id)
                              ON DELETE SET NULL,
  batch_id        TEXT        REFERENCES batches(batch_id)
                              ON DELETE SET NULL,
  day             TEXT,
  time_slot       TIME,
  status          TEXT        NOT NULL DEFAULT 'Available'
                  CHECK (status IN ('Available', 'Unavailable', 'Tentative')),
  notes           TEXT,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE teacher_availability IS
  'NEW: Teacher scheduling availability per batch/offering; drives the teacher-availability scheduling UI.';

CREATE INDEX idx_teacher_availability_teacher_id      ON teacher_availability (teacher_id);
CREATE INDEX idx_teacher_availability_class_option_id ON teacher_availability (class_option_id);
CREATE INDEX idx_teacher_availability_batch_id        ON teacher_availability (batch_id);
CREATE INDEX idx_teacher_availability_status          ON teacher_availability (status);

CREATE TRIGGER trg_teacher_availability_updated_at
  BEFORE UPDATE ON teacher_availability
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================
-- LEVEL 3: Depends on class_options / fellowship_map / batches
-- =============================================================

-- ── students ─────────────────────────────────────────────────
-- Replaces: STUDENTS sheet
-- Core enrolled-student table; class assignment, status, flags, and pool state.
CREATE TABLE students (
  student_id             TEXT        PRIMARY KEY,   -- preserved text ID from Apps Script
  full_name              TEXT        NOT NULL,
  email                  TEXT        NOT NULL,
  phone                  TEXT,
  group_id               TEXT        NOT NULL,
  subgroup_id            TEXT        NOT NULL,
  fellowship_code        TEXT        REFERENCES fellowship_map(fellowship_code)
                                     ON DELETE RESTRICT,
  batch_id               TEXT        REFERENCES batches(batch_id)
                                     ON DELETE SET NULL,
  class_option_id        TEXT        REFERENCES class_options(class_option_id)
                                     ON DELETE RESTRICT,
  teacher_id             TEXT        REFERENCES teachers(teacher_id)
                                     ON DELETE SET NULL,
  teacher_name           TEXT,
  status                 TEXT        NOT NULL DEFAULT 'Active'
                         CHECK (status IN ('Active', 'At Risk', 'Withdrawn', 'Graduated')),
  eligible_for_fs        BOOLEAN     NOT NULL DEFAULT false,
  date_added_elvanto     DATE,
  needs_attention_flag   BOOLEAN     NOT NULL DEFAULT false,
  needs_attention_reason TEXT,
  reason_not_started     TEXT,
  owner                  TEXT,         -- admin point-of-contact
  deleted_at             TIMESTAMPTZ,  -- soft delete
  created_by             TEXT,
  updated_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_students_email UNIQUE (email)
);
COMMENT ON TABLE students IS
  'Replaces: STUDENTS sheet. Enrolled student records; soft-deleted via deleted_at.';

CREATE INDEX idx_students_email                ON students (email);
CREATE INDEX idx_students_group_id             ON students (group_id);
CREATE INDEX idx_students_subgroup_id          ON students (subgroup_id);
CREATE INDEX idx_students_class_option_id      ON students (class_option_id);
CREATE INDEX idx_students_teacher_id           ON students (teacher_id);
CREATE INDEX idx_students_batch_id             ON students (batch_id);
CREATE INDEX idx_students_status               ON students (status);
CREATE INDEX idx_students_fellowship_code      ON students (fellowship_code);
CREATE INDEX idx_students_not_deleted          ON students (student_id)       WHERE deleted_at IS NULL;

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── attendance_forms ─────────────────────────────────────────
-- Replaces: ATTENDANCE_FORMS sheet
-- Registry of attendance form instances (one per group/subgroup/class).
CREATE TABLE attendance_forms (
  attendance_form_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           TEXT        NOT NULL,
  subgroup_id        TEXT        NOT NULL,
  class_option_id    TEXT        REFERENCES class_options(class_option_id)
                                 ON DELETE RESTRICT,
  teacher_id         TEXT        REFERENCES teachers(teacher_id)
                                 ON DELETE SET NULL,
  teacher_name       TEXT,
  form_id            TEXT,         -- legacy Google Form ID; null for Supabase-native forms
  form_edit_url      TEXT,
  form_published_url TEXT,
  active             BOOLEAN     NOT NULL DEFAULT true,
  last_synced        TIMESTAMPTZ,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE attendance_forms IS
  'Replaces: ATTENDANCE_FORMS sheet. Registry of attendance form instances per class.';

CREATE INDEX idx_attendance_forms_group_id        ON attendance_forms (group_id);
CREATE INDEX idx_attendance_forms_class_option_id ON attendance_forms (class_option_id);
CREATE INDEX idx_attendance_forms_teacher_id      ON attendance_forms (teacher_id);
CREATE INDEX idx_attendance_forms_active          ON attendance_forms (active);

CREATE TRIGGER trg_attendance_forms_updated_at
  BEFORE UPDATE ON attendance_forms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── error_submissions ────────────────────────────────────────
-- Replaces: ERROR_SUBMISSIONS sheet
-- Captures form submissions that failed processing for manual triage.
CREATE TABLE error_submissions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_form   TEXT,
  raw_data      JSONB,
  error_message TEXT,
  resolved      BOOLEAN     NOT NULL DEFAULT false,
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE error_submissions IS
  'Replaces: ERROR_SUBMISSIONS sheet. Failed form submissions for manual triage.';

CREATE INDEX idx_error_submissions_resolved ON error_submissions (resolved);

CREATE TRIGGER trg_error_submissions_updated_at
  BEFORE UPDATE ON error_submissions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── email_queue ──────────────────────────────────────────────
-- Replaces: EMAIL_QUEUE sheet
CREATE TABLE email_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT        REFERENCES email_templates(template_key)
                              ON DELETE SET NULL,
  recipient_email TEXT        NOT NULL,
  recipient_name  TEXT,
  student_id      TEXT        REFERENCES students(student_id)
                              ON DELETE SET NULL,
  subject         TEXT,
  body_html       TEXT,
  status          TEXT        NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Pending', 'Sent', 'Failed')),
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE email_queue IS
  'Replaces: EMAIL_QUEUE sheet. Outbound email queue; status tracks Pending → Sent or Failed.';

CREATE INDEX idx_email_queue_recipient_email ON email_queue (recipient_email);
CREATE INDEX idx_email_queue_student_id      ON email_queue (student_id);
CREATE INDEX idx_email_queue_status          ON email_queue (status);

CREATE TRIGGER trg_email_queue_updated_at
  BEFORE UPDATE ON email_queue
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── class_roster ─────────────────────────────────────────────
-- Replaces: CLASS_ROSTER sheet
-- Enrolment roster linking students to class offerings per batch.
CREATE TABLE class_roster (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      TEXT        NOT NULL
                  REFERENCES students(student_id)
                  ON DELETE RESTRICT,
  class_option_id TEXT        NOT NULL
                  REFERENCES class_options(class_option_id)
                  ON DELETE RESTRICT,
  batch_id        TEXT        REFERENCES batches(batch_id)
                              ON DELETE SET NULL,
  group_id        TEXT        NOT NULL,
  subgroup_id     TEXT        NOT NULL,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT        NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active', 'Withdrawn', 'Graduated')),
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (student_id, class_option_id, batch_id)
);
COMMENT ON TABLE class_roster IS
  'Replaces: CLASS_ROSTER sheet. Enrolment roster; links students to class offerings per batch.';

CREATE INDEX idx_class_roster_student_id      ON class_roster (student_id);
CREATE INDEX idx_class_roster_class_option_id ON class_roster (class_option_id);
CREATE INDEX idx_class_roster_batch_id        ON class_roster (batch_id);
CREATE INDEX idx_class_roster_group_id        ON class_roster (group_id);
CREATE INDEX idx_class_roster_status          ON class_roster (status);

CREATE TRIGGER trg_class_roster_updated_at
  BEFORE UPDATE ON class_roster
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================
-- LEVEL 4: Depends on students
-- =============================================================

-- ── attendance_log ───────────────────────────────────────────
-- Replaces: ATTENDANCE_LOG sheet
-- Per-student per-class-week attendance records with risk detection flags.
-- Requires PostgreSQL 15+ for UNIQUE NULLS NOT DISTINCT.
CREATE TABLE attendance_log (
  attendance_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              TEXT        NOT NULL
                          REFERENCES students(student_id)
                          ON DELETE RESTRICT,
  group_id                TEXT        NOT NULL,
  subgroup_id             TEXT        NOT NULL,
  batch_id                TEXT        REFERENCES batches(batch_id)
                                      ON DELETE RESTRICT,
  class_option_id         TEXT        REFERENCES class_options(class_option_id)
                                      ON DELETE RESTRICT,
  teacher_name            TEXT,
  class_number            TEXT,         -- '1'–'7', or '4A'/'4B'
  class_date              DATE,
  present                 BOOLEAN     NOT NULL DEFAULT false,
  made_up                 BOOLEAN     NOT NULL DEFAULT false,
  makeup_date             DATE,
  submitted_by_teacher    BOOLEAN     NOT NULL DEFAULT false,
  submission_date         TIMESTAMPTZ,
  missing_submission_flag BOOLEAN     NOT NULL DEFAULT false,
  class1_no_show_flag     BOOLEAN     NOT NULL DEFAULT false,
  consecutive_miss_count  INTEGER     NOT NULL DEFAULT 0,
  repeat_absentee_flag    BOOLEAN     NOT NULL DEFAULT false,
  response_id             TEXT,         -- legacy Google Form response ID
  logged_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevents duplicate submissions for the same student/class/week/date.
  -- NULLS NOT DISTINCT: two NULLs in the same column are treated as equal,
  -- so a missing class_option_id or class_date still blocks duplicates.
  CONSTRAINT uq_attendance_no_dup
    UNIQUE NULLS NOT DISTINCT (student_id, class_option_id, class_number, class_date),
  -- A row cannot be simultaneously present and counted as a makeup.
  CONSTRAINT chk_attendance_present_makeup CHECK (NOT (present AND made_up))
);
COMMENT ON TABLE attendance_log IS
  'Replaces: ATTENDANCE_LOG sheet. Per-student per-week attendance with risk flags (no-show, repeat absentee, missing submission).';

CREATE INDEX idx_attendance_log_student_id      ON attendance_log (student_id);
CREATE INDEX idx_attendance_log_class_option_id ON attendance_log (class_option_id);
CREATE INDEX idx_attendance_log_batch_id        ON attendance_log (batch_id);
CREATE INDEX idx_attendance_log_group_id        ON attendance_log (group_id);
CREATE INDEX idx_attendance_log_class_number    ON attendance_log (class_number);
CREATE INDEX idx_attendance_log_class_date      ON attendance_log (class_date);
CREATE INDEX idx_attendance_log_student_batch   ON attendance_log (student_id, batch_id);


-- ── ft_pipeline ──────────────────────────────────────────────
-- Replaces: FT_PIPELINE sheet
-- Follow-Through pipeline: Elvanto members not yet enrolled in Foundation School.
-- Populated from elvanto_import; tracks week-3 and week-6 follow-up flags.
CREATE TABLE ft_pipeline (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT        NOT NULL UNIQUE,
  full_name        TEXT,
  phone            TEXT,
  date_added       DATE,
  week3_flag_date  DATE,
  week3_flag_fired BOOLEAN     NOT NULL DEFAULT false,
  week6_flag_date  DATE,
  week6_flag_fired BOOLEAN     NOT NULL DEFAULT false,
  contact_notes    TEXT,
  contacted_by     TEXT,
  contact_date     DATE,
  follow_up_status TEXT,
  converted_to_fs  BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE ft_pipeline IS
  'Replaces: FT_PIPELINE sheet. Follow-Through tracking for Elvanto members eligible but not yet enrolled.';

CREATE INDEX idx_ft_pipeline_email           ON ft_pipeline (email);
CREATE INDEX idx_ft_pipeline_converted_to_fs ON ft_pipeline (converted_to_fs);
CREATE INDEX idx_ft_pipeline_week3_flag_date ON ft_pipeline (week3_flag_date);
CREATE INDEX idx_ft_pipeline_week6_flag_date ON ft_pipeline (week6_flag_date);

CREATE TRIGGER trg_ft_pipeline_updated_at
  BEFORE UPDATE ON ft_pipeline
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── eligible_pool ────────────────────────────────────────────
-- Replaces: ELIGIBLE_POOL sheet
-- Eligible members not yet graduated; drives the escalation logic
-- (>42 days Not Started → escalation_flag = true).
CREATE TABLE eligible_pool (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           TEXT        NOT NULL UNIQUE
                       REFERENCES students(student_id)
                       ON DELETE CASCADE,
  full_name            TEXT,
  email                TEXT,
  group_id             TEXT        NOT NULL,
  subgroup_id          TEXT        NOT NULL,
  eligible_pool_status TEXT        NOT NULL DEFAULT 'Not Started'
                       CHECK (eligible_pool_status IN
                         ('Not Started', 'Registered', 'In Progress', 'Graduated')),
  next_action_deadline DATE,
  contact_outcome      TEXT,
  contacted_by         TEXT,
  contact_date         DATE,
  escalation_notes     TEXT,
  reason_not_started   TEXT,
  days_in_pool         INTEGER     NOT NULL DEFAULT 0,
  escalation_flag      BOOLEAN     NOT NULL DEFAULT false,
  created_by           TEXT,
  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE eligible_pool IS
  'Replaces: ELIGIBLE_POOL sheet. Eligible members tracking; escalation_flag fires after 42 days Not Started or overdue deadline.';

CREATE INDEX idx_eligible_pool_email               ON eligible_pool (email);
CREATE INDEX idx_eligible_pool_group_id            ON eligible_pool (group_id);
CREATE INDEX idx_eligible_pool_eligible_pool_status ON eligible_pool (eligible_pool_status);
CREATE INDEX idx_eligible_pool_escalation_flag     ON eligible_pool (escalation_flag);

CREATE TRIGGER trg_eligible_pool_updated_at
  BEFORE UPDATE ON eligible_pool
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── moodle_sync ──────────────────────────────────────────────
-- Replaces: MOODLE_SYNC sheet
-- Per-student Moodle LMS progress synced from the external Moodle instance.
CREATE TABLE moodle_sync (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            TEXT         NOT NULL
                        REFERENCES students(student_id)
                        ON DELETE RESTRICT,
  batch_id              TEXT         REFERENCES batches(batch_id)
                                     ON DELETE SET NULL,
  subgroup_id           TEXT,
  assignments_completed INTEGER      NOT NULL DEFAULT 0,
  assignments_total     INTEGER      NOT NULL DEFAULT 0,
  exam_passed           BOOLEAN      NOT NULL DEFAULT false,
  moodle_progress       NUMERIC(5,2) NOT NULL DEFAULT 0.00,  -- 0.00–100.00
  synced_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_moodle_sync_student_batch UNIQUE NULLS NOT DISTINCT (student_id, batch_id)
);
COMMENT ON TABLE moodle_sync IS
  'Replaces: MOODLE_SYNC sheet. Moodle LMS data per student: feeds graduation Gate 2 (assignments) and Gate 3 (exam).';

CREATE INDEX idx_moodle_sync_student_id  ON moodle_sync (student_id);
CREATE INDEX idx_moodle_sync_batch_id    ON moodle_sync (batch_id);
CREATE INDEX idx_moodle_sync_subgroup_id ON moodle_sync (subgroup_id);

CREATE TRIGGER trg_moodle_sync_updated_at
  BEFORE UPDATE ON moodle_sync
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── graduation_review ────────────────────────────────────────
-- Replaces: GRADUATION_REVIEW sheet
-- Four-gate graduation readiness tracker per student per batch.
-- Gate 1: all 7 weeks attended or made up (source: attendance_log)
-- Gate 2: all Moodle assignments complete   (source: moodle_sync)
-- Gate 3: Moodle exam passed                (source: moodle_sync)
-- Gate 4: cell group integrated             (manual flag or eligible_pool_status = 'Graduated')
CREATE TABLE graduation_review (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            TEXT        NOT NULL
                        REFERENCES students(student_id)
                        ON DELETE RESTRICT,
  batch_id              TEXT        NOT NULL
                        REFERENCES batches(batch_id)
                        ON DELETE RESTRICT,
  subgroup_id           TEXT,
  gate1_attendance      BOOLEAN     NOT NULL DEFAULT false,
  gate2_assignments     BOOLEAN     NOT NULL DEFAULT false,
  gate3_exam_passed     BOOLEAN     NOT NULL DEFAULT false,
  gate4_cell_integrated BOOLEAN     NOT NULL DEFAULT false,
  all_gates_met         BOOLEAN     NOT NULL DEFAULT false,
  graduation_status     TEXT        NOT NULL DEFAULT 'Not Ready'
                        CHECK (graduation_status IN ('Not Ready', 'Close', 'Ready')),
  notes                 TEXT,
  last_checked_at       TIMESTAMPTZ,
  reviewed_by           TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, batch_id),
  -- all_gates_met must equal the conjunction of all four gate booleans
  CONSTRAINT chk_graduation_all_gates_met
    CHECK (all_gates_met = (gate1_attendance AND gate2_assignments AND gate3_exam_passed AND gate4_cell_integrated)),
  -- graduation_status must be derived from the gate count (mirrors Apps Script logic)
  CONSTRAINT chk_graduation_status
    CHECK (graduation_status = CASE
      WHEN gate1_attendance AND gate2_assignments AND gate3_exam_passed AND gate4_cell_integrated THEN 'Ready'
      WHEN (gate1_attendance::int + gate2_assignments::int + gate3_exam_passed::int + gate4_cell_integrated::int) = 3 THEN 'Close'
      ELSE 'Not Ready'
    END)
);
COMMENT ON TABLE graduation_review IS
  'Replaces: GRADUATION_REVIEW sheet. Four-gate graduation readiness per student per batch.';

CREATE INDEX idx_graduation_review_student_id        ON graduation_review (student_id);
CREATE INDEX idx_graduation_review_batch_id          ON graduation_review (batch_id);
CREATE INDEX idx_graduation_review_graduation_status ON graduation_review (graduation_status);
CREATE INDEX idx_graduation_review_all_gates_met     ON graduation_review (all_gates_met);

CREATE TRIGGER trg_graduation_review_updated_at
  BEFORE UPDATE ON graduation_review
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── teacher_roster_log ───────────────────────────────────────
-- Replaces: TEACHER_ROSTER_LOG sheet
-- Append-only audit trail of teacher-to-class assignment changes.
CREATE TABLE teacher_roster_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id          TEXT        NOT NULL
                      REFERENCES teachers(teacher_id)
                      ON DELETE RESTRICT,
  class_option_id     TEXT        REFERENCES class_options(class_option_id)
                                  ON DELETE SET NULL,
  batch_id            TEXT        REFERENCES batches(batch_id)
                                  ON DELETE SET NULL,
  action              TEXT        NOT NULL,   -- Assigned | Removed | Replaced
  previous_teacher_id TEXT,
  notes               TEXT,
  changed_by          TEXT,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE teacher_roster_log IS
  'Replaces: TEACHER_ROSTER_LOG sheet. Append-only audit trail of teacher assignment events per class.';

CREATE INDEX idx_teacher_roster_log_teacher_id      ON teacher_roster_log (teacher_id);
CREATE INDEX idx_teacher_roster_log_class_option_id ON teacher_roster_log (class_option_id);
CREATE INDEX idx_teacher_roster_log_batch_id        ON teacher_roster_log (batch_id);


-- =============================================================
-- LEVEL 5: Depends on students + graduation_review
-- =============================================================

-- ── makeup_queue ─────────────────────────────────────────────
-- Replaces: MAKEUP_QUEUE (referenced in 70_GRADUATION.js)
-- Tracks missed classes requiring a makeup session before graduation Gate 1 can pass.
CREATE TABLE makeup_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       TEXT        NOT NULL
                   REFERENCES students(student_id)
                   ON DELETE RESTRICT,
  subgroup_id      TEXT,
  batch_id         TEXT        NOT NULL
                   REFERENCES batches(batch_id)
                   ON DELETE RESTRICT,
  class_number     TEXT        NOT NULL,   -- '1'–'7'
  makeup_type      TEXT        NOT NULL DEFAULT 'Standard',  -- Standard | Escalated
  deadline         DATE,
  makeup_completed BOOLEAN     NOT NULL DEFAULT false,
  completed_date   DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE makeup_queue IS
  'Replaces: MAKEUP_QUEUE sheet. Missed-class makeup queue; unresolved entries block graduation Gate 1.';

CREATE INDEX idx_makeup_queue_student_id       ON makeup_queue (student_id);
CREATE INDEX idx_makeup_queue_batch_id         ON makeup_queue (batch_id);
CREATE INDEX idx_makeup_queue_makeup_completed ON makeup_queue (makeup_completed);

CREATE TRIGGER trg_makeup_queue_updated_at
  BEFORE UPDATE ON makeup_queue
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── transition_log ───────────────────────────────────────────
-- Replaces: TRANSITION_LOG sheet
-- Post-graduation cell placement tracking; overdue_flag fires after 21 days unplaced.
CREATE TABLE transition_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       TEXT        NOT NULL
                   REFERENCES students(student_id)
                   ON DELETE RESTRICT,
  graduation_date  DATE        NOT NULL,
  batch_id         TEXT        REFERENCES batches(batch_id)
                               ON DELETE SET NULL,
  placement_deadline DATE,
  target_group     TEXT,
  placed_by        TEXT,
  placement_date   DATE,
  placement_status TEXT        NOT NULL DEFAULT 'Pending'
                   CHECK (placement_status IN ('Pending', 'Placed', 'Stalled')),
  overdue_flag     BOOLEAN     NOT NULL DEFAULT false,
  notes            TEXT,
  created_by       TEXT,
  updated_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE transition_log IS
  'Replaces: TRANSITION_LOG sheet. Post-graduation cell placement; overdue_flag fires at 21 days without placement.';

CREATE INDEX idx_transition_log_student_id       ON transition_log (student_id);
CREATE INDEX idx_transition_log_batch_id         ON transition_log (batch_id);
CREATE INDEX idx_transition_log_placement_status ON transition_log (placement_status);
CREATE INDEX idx_transition_log_overdue_flag     ON transition_log (overdue_flag);

CREATE TRIGGER trg_transition_log_updated_at
  BEFORE UPDATE ON transition_log
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ── feedback_log ─────────────────────────────────────────────
-- Replaces: FEEDBACK_LOG sheet
-- Student feedback per class/subgroup; overall_score feeds group_summary averages.
CREATE TABLE feedback_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      TEXT         REFERENCES students(student_id)
                               ON DELETE SET NULL,
  subgroup_id     TEXT         NOT NULL,
  batch_id        TEXT         REFERENCES batches(batch_id)
                               ON DELETE SET NULL,
  class_option_id TEXT         REFERENCES class_options(class_option_id)
                               ON DELETE SET NULL,
  overall_score   NUMERIC(3,1),  -- e.g. 4.5 out of 5
  comments        TEXT,
  submitted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE feedback_log IS
  'Replaces: FEEDBACK_LOG sheet. Student feedback; overall_score aggregated into group_summary.avg_feedback_score.';

CREATE INDEX idx_feedback_log_student_id      ON feedback_log (student_id);
CREATE INDEX idx_feedback_log_subgroup_id     ON feedback_log (subgroup_id);
CREATE INDEX idx_feedback_log_batch_id        ON feedback_log (batch_id);
CREATE INDEX idx_feedback_log_class_option_id ON feedback_log (class_option_id);

CREATE TRIGGER trg_feedback_log_updated_at
  BEFORE UPDATE ON feedback_log
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================
-- LEVEL 6: Aggregate / computed tables
-- =============================================================

-- ── group_summary ────────────────────────────────────────────
-- Replaces: GROUP_SUMMARY sheet
-- Denormalized group-level metrics refreshed by the buildGroupSummary job.
CREATE TABLE group_summary (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              TEXT         NOT NULL,
  subgroup_id           TEXT         NOT NULL,
  total_students        INTEGER      NOT NULL DEFAULT 0,
  active_count          INTEGER      NOT NULL DEFAULT 0,
  at_risk_count         INTEGER      NOT NULL DEFAULT 0,
  eligible_pool_count   INTEGER      NOT NULL DEFAULT 0,
  classes_running       INTEGER      NOT NULL DEFAULT 0,
  avg_moodle_progress   NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  graduated_gates_count INTEGER      NOT NULL DEFAULT 0,
  graduated_count       INTEGER      NOT NULL DEFAULT 0,
  cell_integrated_count INTEGER      NOT NULL DEFAULT 0,
  placed_count          INTEGER      NOT NULL DEFAULT 0,
  ft_conversion_rate    NUMERIC(5,4) NOT NULL DEFAULT 0.0000,  -- 0.0000–1.0000
  avg_feedback_score    NUMERIC(3,1) NOT NULL DEFAULT 0.0,
  last_updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (group_id, subgroup_id)
);
COMMENT ON TABLE group_summary IS
  'Replaces: GROUP_SUMMARY sheet. Denormalized aggregate metrics per group/subgroup; refreshed on demand by buildGroupSummary.';

-- group_id and subgroup_id are covered by UNIQUE (group_id, subgroup_id); no separate indexes needed.

CREATE TRIGGER trg_group_summary_updated_at
  BEFORE UPDATE ON group_summary
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ===== END 001_initial_schema.sql =====


-- ===== BEGIN 002_seed_data.sql =====

-- =============================================================
-- 002_seed_data.sql
-- Foundation School — safe, idempotent seed data
-- =============================================================
--
-- IMPORTANT — tables that require CSV import before go-live:
-- ┌──────────────────┬────────────────────────────────────────────────────┐
-- │ Table            │ Source                                             │
-- ├──────────────────┼────────────────────────────────────────────────────┤
-- │ fellowship_map   │ Export FELLOWSHIP_MAP sheet → CSV → import via     │
-- │                  │ Supabase dashboard or COPY command.                │
-- │                  │ Do NOT rely on this file for fellowship data.      │
-- ├──────────────────┼────────────────────────────────────────────────────┤
-- │ teachers         │ Export TEACHERS sheet → CSV. Preserve teacher_id   │
-- │                  │ text values exactly as used in Apps Script.        │
-- ├──────────────────┼────────────────────────────────────────────────────┤
-- │ class_options    │ Export CLASS_OPTIONS sheet → CSV. Preserve         │
-- │                  │ class_option_id and class_id text values exactly.  │
-- │                  │ Note: column "time" → renamed to "class_time".     │
-- └──────────────────┴────────────────────────────────────────────────────┘
--
-- All INSERT statements use ON CONFLICT DO NOTHING so this file
-- is safe to re-run at any time without duplicating rows.
-- =============================================================


-- =============================================================
-- 1. config
-- System-level key/value configuration.
-- =============================================================

INSERT INTO config (key, value) VALUES

  -- Core system identifiers
  -- FILL THESE IN before running in production:
  ('FORM_ID_OR_URL',            ''),                        -- TODO: set to Phase 1 registration form ID
  ('SYSTEM_SPREADSHEET_ID',     ''),                        -- TODO: set to Foundation School spreadsheet ID

  -- Timezone
  ('SYSTEM_TIMEZONE',           'America/Toronto'),

  -- Form / UI behaviour (from 00_Config.gs)
  ('INCLUDE_CLASS_ID_IN_LABEL', 'false'),
  ('WEEKDAY_NORMALIZE',         'true'),
  ('SORT_CHOICES',              'true'),
  ('EMPTY_CHOICE_LABEL',        '(No active classes yet)'),

  -- Email sender identity (from 00_Constants.js)
  ('SENDER_NAME',               'Foundation School Team'),
  ('REPLY_TO',                  'info@lwcanada.org'),
  ('SEND_AS',                   ''),
  ('FS_ADMIN_EMAIL',            'info@lwcanada.org'),

  -- Teacher roster cadence (from 00_Constants.js)
  ('ROSTER_SEND_MODE',          'DAILY'),
  ('ROSTER_SEND_HOUR',          '7'),
  ('ROSTER_SEND_WEEKDAY',       '1'),       -- 1 = Monday

  -- Email type constants
  ('EMAIL_TYPE_TEACHER_ROSTER', 'TEACHER_ROSTER'),
  ('ROSTER_SEND_TYPE_T_MINUS_3','T_MINUS_3'),
  ('ROSTER_SEND_TYPE_DAY_OF',   'DAY_OF'),

  -- Script property key (Apps Script parity reference)
  ('PROP_LAST_RESPONSE_ID',     'FS_LAST_PROCESSED_RESPONSE_ID'),

  -- Phase 1 form labels (from 00_Config.gs)
  ('PHASE1_NONE_OPTION',              'None of these times work for me'),
  ('PHASE1_SECTION_QUESTION_TITLE',   'Which class would you like to join?'),
  ('PHASE1_ENTRY_QUESTION_TITLE',     'Which fellowship are you from?'),
  ('CAMPUS_QUESTION_TITLE',           'Which campus are you from?'),
  ('FULLNAME_Q_TITLE',                'Full Name'),
  ('EMAIL_Q_TITLE',                   'Email'),
  ('PHONE_Q_TITLE',                   'Phone Number'),
  ('FIRSTNAME_Q_TITLE',               'First Name'),
  ('LASTNAME_Q_TITLE',                'Last Name'),

  -- Attendance form
  ('ATTENDANCE_FORM_TITLE_PREFIX',    'Foundation School Attendance')

ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- 2. batches
-- =============================================================
--
-- IMPORTANT — column rename notice:
-- Migration 004_batch_management.sql renames the "name" column to
-- "batch_name". This INSERT uses "name" because 002 runs BEFORE 004
-- in the standard 001→002→003→004 sequence. Do NOT add new batch rows
-- using "name" after applying 004; use "batch_name" instead.
--
-- To add batches in production: use the Batch Management section in
-- the admin portal, or INSERT directly using batch_name.

INSERT INTO batches (
  batch_id,
  name,
  start_sunday,
  start_date,
  registration_open,
  active
) VALUES (
  '2025A',
  'Foundation School 2025 — Batch A',
  '2025-09-01',
  '2025-09-01',
  false,
  true
)
ON CONFLICT (batch_id) DO NOTHING;


-- =============================================================
-- 3. email_templates
-- Stub rows — body_html must be filled in before go-live.
-- =============================================================

INSERT INTO email_templates (template_key, subject, body_html, active) VALUES

  ('WELCOME',
   'Welcome to Foundation School',
   '', true),

  ('CLASS_ASSIGNED',
   'Your Foundation School class has been assigned',
   '', true),

  ('TEACHER_ROSTER_DAILY',
   '[Foundation School] Daily Teacher Roster',
   '', true),

  ('TEACHER_ROSTER_WEEKLY',
   '[Foundation School] Weekly Teacher Roster',
   '', true),

  ('WEEK3_FOLLOWUP',
   '[Foundation School] Week 3 Follow-Up',
   '', true),

  ('WEEK6_FOLLOWUP',
   '[Foundation School] Week 6 Follow-Up',
   '', true),

  ('ATTENDANCE_FLAG_CLASS1',
   '[Foundation School] Class 1 No-Show Alert',
   '', true),

  ('ATTENDANCE_FLAG_REPEAT',
   '[Foundation School] Repeat Absentee Alert',
   '', true),

  ('GRADUATION_READY',
   'Congratulations — You Are Ready to Graduate!',
   '', true),

  ('TRANSITION_OVERDUE',
   '[Foundation School] Cell Placement Overdue',
   '', true)

ON CONFLICT (template_key) DO NOTHING;

-- ===== END 002_seed_data.sql =====


-- ===== BEGIN 003_rls_policies.sql =====

-- =============================================================
-- 003_rls_policies.sql
-- Foundation School — Row Level Security policies
-- =============================================================
--
-- Role model:
-- ┌──────────────────┬─────────────────────────────────────────────────────┐
-- │ Role             │ Who                                                 │
-- ├──────────────────┼─────────────────────────────────────────────────────┤
-- │ anon             │ Public users (unauthenticated); uses Supabase        │
-- │                  │ anon key. Limited to registration lookup + submit.  │
-- ├──────────────────┼─────────────────────────────────────────────────────┤
-- │ authenticated    │ Staff / admins who have signed in via Supabase Auth.│
-- │                  │ Full read access; scoped write access per table.    │
-- ├──────────────────┼─────────────────────────────────────────────────────┤
-- │ service_role     │ Edge Functions and server-side jobs running with    │
-- │                  │ the service role key. Bypasses RLS entirely —       │
-- │                  │ no explicit policies needed.                        │
-- └──────────────────┴─────────────────────────────────────────────────────┘
--
-- Notes:
-- • service_role bypasses RLS — audit_log, teacher_roster_log, and
--   elvanto_import are fully accessible to service_role even though
--   no anon/authenticated policies are defined for them.
-- • No student-facing auth exists yet; all public flows go through anon.
-- • Policy names follow the pattern: <table>_<role>_<operation>.
-- =============================================================


-- =============================================================
-- Enable RLS on every table
-- =============================================================

ALTER TABLE config                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fellowship_map        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE elvanto_import        ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_slots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE applicants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_availability  ENABLE ROW LEVEL SECURITY;
ALTER TABLE students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_forms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_roster          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ft_pipeline           ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligible_pool         ENABLE ROW LEVEL SECURITY;
ALTER TABLE moodle_sync           ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduation_review     ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_roster_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE makeup_queue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transition_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_summary         ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- PUBLIC (anon) — SELECT only, filtered rows
-- =============================================================

-- Active fellowships for the registration form campus dropdown
CREATE POLICY fellowship_map_anon_select ON fellowship_map
  FOR SELECT TO anon
  USING (active = true);

-- Active, non-deleted class options for the class selection step
CREATE POLICY class_options_anon_select ON class_options
  FOR SELECT TO anon
  USING (active = true AND deleted_at IS NULL);

-- Active, non-deleted teachers (needed for class display labels)
CREATE POLICY teachers_anon_select ON teachers
  FOR SELECT TO anon
  USING (active = true AND deleted_at IS NULL);

-- Batches that are currently open for registration
CREATE POLICY batches_anon_select ON batches
  FOR SELECT TO anon
  USING (registration_open = true);

-- Full config read (no secrets stored here; form labels, flags only)
CREATE POLICY config_anon_select ON config
  FOR SELECT TO anon
  USING (true);


-- =============================================================
-- PUBLIC (anon) — INSERT only
-- =============================================================

-- Phase 1 registration form submissions
CREATE POLICY applicants_anon_insert ON applicants
  FOR INSERT TO anon
  WITH CHECK (true);

-- Failed-submission capture from the public registration flow
CREATE POLICY error_submissions_anon_insert ON error_submissions
  FOR INSERT TO anon
  WITH CHECK (true);


-- =============================================================
-- AUTHENTICATED STAFF — full SELECT on all tables
-- =============================================================

CREATE POLICY config_staff_select             ON config             FOR SELECT TO authenticated USING (true);
CREATE POLICY fellowship_map_staff_select     ON fellowship_map     FOR SELECT TO authenticated USING (true);
CREATE POLICY teachers_staff_select           ON teachers           FOR SELECT TO authenticated USING (true);
CREATE POLICY email_templates_staff_select    ON email_templates    FOR SELECT TO authenticated USING (true);
CREATE POLICY sync_log_staff_select           ON sync_log           FOR SELECT TO authenticated USING (true);
CREATE POLICY audit_log_staff_select          ON audit_log          FOR SELECT TO authenticated USING (true);
CREATE POLICY elvanto_import_staff_select     ON elvanto_import     FOR SELECT TO authenticated USING (true);
CREATE POLICY batches_staff_select            ON batches            FOR SELECT TO authenticated USING (true);
CREATE POLICY class_options_staff_select      ON class_options      FOR SELECT TO authenticated USING (true);
CREATE POLICY form_sections_staff_select      ON form_sections      FOR SELECT TO authenticated USING (true);
CREATE POLICY class_slots_staff_select        ON class_slots        FOR SELECT TO authenticated USING (true);
CREATE POLICY applicants_staff_select         ON applicants         FOR SELECT TO authenticated USING (true);
CREATE POLICY teacher_availability_staff_select ON teacher_availability FOR SELECT TO authenticated USING (true);
CREATE POLICY students_staff_select           ON students           FOR SELECT TO authenticated USING (true);
CREATE POLICY attendance_forms_staff_select   ON attendance_forms   FOR SELECT TO authenticated USING (true);
CREATE POLICY error_submissions_staff_select  ON error_submissions  FOR SELECT TO authenticated USING (true);
CREATE POLICY email_queue_staff_select        ON email_queue        FOR SELECT TO authenticated USING (true);
CREATE POLICY class_roster_staff_select       ON class_roster       FOR SELECT TO authenticated USING (true);
CREATE POLICY attendance_log_staff_select     ON attendance_log     FOR SELECT TO authenticated USING (true);
CREATE POLICY ft_pipeline_staff_select        ON ft_pipeline        FOR SELECT TO authenticated USING (true);
CREATE POLICY eligible_pool_staff_select      ON eligible_pool      FOR SELECT TO authenticated USING (true);
CREATE POLICY moodle_sync_staff_select        ON moodle_sync        FOR SELECT TO authenticated USING (true);
CREATE POLICY graduation_review_staff_select  ON graduation_review  FOR SELECT TO authenticated USING (true);
CREATE POLICY teacher_roster_log_staff_select ON teacher_roster_log FOR SELECT TO authenticated USING (true);
CREATE POLICY makeup_queue_staff_select       ON makeup_queue       FOR SELECT TO authenticated USING (true);
CREATE POLICY transition_log_staff_select     ON transition_log     FOR SELECT TO authenticated USING (true);
CREATE POLICY feedback_log_staff_select       ON feedback_log       FOR SELECT TO authenticated USING (true);
CREATE POLICY group_summary_staff_select      ON group_summary      FOR SELECT TO authenticated USING (true);


-- =============================================================
-- AUTHENTICATED STAFF — INSERT / UPDATE (operational tables)
-- These tables grow through normal program operation.
-- =============================================================

CREATE POLICY students_staff_insert ON students
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY students_staff_update ON students
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY attendance_log_staff_insert ON attendance_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY attendance_log_staff_update ON attendance_log
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY eligible_pool_staff_insert ON eligible_pool
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY eligible_pool_staff_update ON eligible_pool
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY moodle_sync_staff_insert ON moodle_sync
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY moodle_sync_staff_update ON moodle_sync
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY graduation_review_staff_insert ON graduation_review
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY graduation_review_staff_update ON graduation_review
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY ft_pipeline_staff_insert ON ft_pipeline
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ft_pipeline_staff_update ON ft_pipeline
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY class_roster_staff_insert ON class_roster
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY class_roster_staff_update ON class_roster
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY makeup_queue_staff_insert ON makeup_queue
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY makeup_queue_staff_update ON makeup_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY transition_log_staff_insert ON transition_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY transition_log_staff_update ON transition_log
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY teacher_availability_staff_insert ON teacher_availability
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY teacher_availability_staff_update ON teacher_availability
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY email_queue_staff_insert ON email_queue
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY email_queue_staff_update ON email_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sync_log_staff_insert ON sync_log
  FOR INSERT TO authenticated WITH CHECK (true);


-- =============================================================
-- AUTHENTICATED STAFF — full INSERT / UPDATE / DELETE
-- Configuration and reference tables managed by admins.
-- =============================================================

CREATE POLICY class_options_staff_insert ON class_options
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY class_options_staff_update ON class_options
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY class_options_staff_delete ON class_options
  FOR DELETE TO authenticated USING (true);

CREATE POLICY class_slots_staff_insert ON class_slots
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY class_slots_staff_update ON class_slots
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY class_slots_staff_delete ON class_slots
  FOR DELETE TO authenticated USING (true);

CREATE POLICY teachers_staff_insert ON teachers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY teachers_staff_update ON teachers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY teachers_staff_delete ON teachers
  FOR DELETE TO authenticated USING (true);

CREATE POLICY fellowship_map_staff_insert ON fellowship_map
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY fellowship_map_staff_update ON fellowship_map
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fellowship_map_staff_delete ON fellowship_map
  FOR DELETE TO authenticated USING (true);

CREATE POLICY batches_staff_insert ON batches
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY batches_staff_update ON batches
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY batches_staff_delete ON batches
  FOR DELETE TO authenticated USING (true);

CREATE POLICY email_templates_staff_insert ON email_templates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY email_templates_staff_update ON email_templates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY email_templates_staff_delete ON email_templates
  FOR DELETE TO authenticated USING (true);

CREATE POLICY form_sections_staff_insert ON form_sections
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY form_sections_staff_update ON form_sections
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY form_sections_staff_delete ON form_sections
  FOR DELETE TO authenticated USING (true);

CREATE POLICY group_summary_staff_insert ON group_summary
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY group_summary_staff_update ON group_summary
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY group_summary_staff_delete ON group_summary
  FOR DELETE TO authenticated USING (true);

-- Applicants: staff can update (approve/reject) and delete (spam/error cleanup)
CREATE POLICY applicants_staff_update ON applicants
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY applicants_staff_delete ON applicants
  FOR DELETE TO authenticated USING (true);

-- error_submissions: staff can update (mark resolved) and delete
CREATE POLICY error_submissions_staff_update ON error_submissions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY error_submissions_staff_delete ON error_submissions
  FOR DELETE TO authenticated USING (true);

-- feedback_log: staff can insert (manual entry) and update
CREATE POLICY feedback_log_staff_insert ON feedback_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY feedback_log_staff_update ON feedback_log
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- =============================================================
-- SERVICE ROLE ONLY — no anon or authenticated policies
-- audit_log, teacher_roster_log, elvanto_import have no policies
-- defined here. service_role bypasses RLS and can access them
-- freely. Authenticated staff have SELECT only (defined above).
-- These tables should never be writable from the client.
-- =============================================================

-- (no additional policies needed — service_role bypass covers writes)

-- ===== END 003_rls_policies.sql =====


-- ===== BEGIN 004_batch_management.sql =====

-- =============================================================
-- 004_batch_management.sql
-- Foundation School — Batch lifecycle management
-- =============================================================
--
-- Changes in this migration:
--   1. Extend batches table:
--        - Rename name → batch_name
--        - Add status TEXT (Draft/Open/Active/Completed/Archived/Suspended)
--        - Add archived BOOLEAN + archived_at TIMESTAMPTZ
--        - Add id UUID (surrogate; batch_id TEXT remains the PK + FK anchor)
--        - Backfill status from active/registration_open state
--        - Add partial unique indexes (one active, one reg-open at a time)
--   2. Add batch_id to applicants (registration locking)
--   3. Create batch_moodle_courses (Moodle prep per Task 7)
--   4. is_superadmin() RLS helper function
--   5. Restrict batches writes to superadmin only
--   6. RLS policies for batch_moodle_courses
--
-- NOTE on batch_id vs id:
--   The spec calls for id uuid primary key + batch_id text unique.
--   This migration keeps batch_id as the TEXT PRIMARY KEY because every
--   other table already references it as a FK. Changing the PK would
--   require cascading ALTER TABLE across 15+ tables. The id UUID column
--   is added as a non-PK surrogate for API consumers that prefer UUID refs.
--
-- NOTE on 002_seed_data.sql:
--   002 seeds batch 2025A using column name "name" (pre-rename).
--   When migrations run in order (001→002→003→004) on a fresh DB this is
--   correct — the rename happens after the seed. Do not run 002 standalone
--   after applying 004; use batch_name in any new seed rows.
-- =============================================================

BEGIN;

-- =============================================================
-- 1. Extend batches table
-- =============================================================

-- Rename name → batch_name (guarded so re-runs don't error)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'batches'
      AND column_name = 'name'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'batches'
      AND column_name = 'batch_name'
  ) THEN
    ALTER TABLE public.batches RENAME COLUMN name TO batch_name;
  END IF;
END $$;

-- Add new columns (all IF NOT EXISTS so migration is re-runnable)
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS id          UUID        DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS status      TEXT        NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS archived    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- status CHECK constraint (drop first to allow clean re-runs)
ALTER TABLE batches DROP CONSTRAINT IF EXISTS chk_batches_status;
UPDATE public.batches
SET status = CASE
  WHEN status IS NULL OR trim(status) = '' THEN 'Draft'
  WHEN lower(status) = 'draft' THEN 'Draft'
  WHEN lower(status) = 'open' THEN 'Open'
  WHEN lower(status) = 'active' THEN 'Active'
  WHEN lower(status) = 'completed' THEN 'Completed'
  WHEN lower(status) = 'archived' THEN 'Archived'
  WHEN lower(status) = 'suspended' THEN 'Suspended'
  WHEN lower(status) IN ('inactive', 'closed') THEN 'Archived'
  WHEN lower(status) IN ('pending') THEN 'Draft'
  ELSE 'Draft'
END;

ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS chk_batches_status;

ALTER TABLE public.batches ADD CONSTRAINT chk_batches_status
  CHECK (status IN ('Draft', 'Open', 'Active', 'Completed', 'Archived', 'Suspended'));
-- Ensure batch_name is populated before making NOT NULL
UPDATE batches SET batch_name = batch_id WHERE batch_name IS NULL OR batch_name = '';
ALTER TABLE batches ALTER COLUMN batch_name SET NOT NULL;

-- Backfill start_sunday from start_date where missing
UPDATE batches
  SET start_sunday = start_date
  WHERE start_sunday IS NULL AND start_date IS NOT NULL;

-- Backfill status from legacy active/registration_open flags
UPDATE batches SET status = CASE
  WHEN archived          = true THEN 'Archived'
  WHEN active            = true THEN 'Active'
  WHEN registration_open = true THEN 'Open'
  ELSE 'Draft'
END WHERE status = 'Draft';

-- Partial unique indexes: enforce one active and one open batch at a time.
-- These are advisory constraints — the UI warns before activating,
-- and the DB enforces it as the final gate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_one_active
  ON batches (active) WHERE active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_one_reg_open
  ON batches (registration_open) WHERE registration_open = true;

-- Covering indexes (used by portal queries + phase2-processor)
CREATE INDEX IF NOT EXISTS idx_batches_status             ON batches (status);
CREATE INDEX IF NOT EXISTS idx_batches_registration_open  ON batches (registration_open);


-- =============================================================
-- 2. Add batch_id to applicants
-- =============================================================
-- Registration locking: every applicant must be tied to a batch.
-- Allows phase2-processor to validate class_slots belong to the
-- same batch the applicant registered for.

ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES batches(batch_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applicants_batch_id ON applicants (batch_id);


-- =============================================================
-- 3. Create batch_moodle_courses
-- =============================================================
-- Controls which Moodle course each group (CE/CS/WS) uses per batch.
-- Subgroups (CSGA, CSGB, etc.) inherit from their parent group's course.
-- Example: CSGA + CSGB both resolve to the CS course for batch 2026A.

CREATE TABLE IF NOT EXISTS batch_moodle_courses (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                  TEXT        NOT NULL
                            REFERENCES batches(batch_id) ON DELETE RESTRICT,
  group_id                  TEXT        NOT NULL,
  subgroups                 TEXT[]      NOT NULL DEFAULT '{}',
  moodle_template_course_id TEXT,
  moodle_course_id          TEXT        NOT NULL,
  moodle_course_name        TEXT,
  moodle_course_url         TEXT,
  active                    BOOLEAN     NOT NULL DEFAULT true,
  created_by                TEXT,
  updated_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, group_id),
  CONSTRAINT chk_batch_moodle_group_id CHECK (group_id IN ('CE', 'CS', 'WS'))
);
COMMENT ON TABLE batch_moodle_courses IS
  'Maps Moodle course IDs to batch + group. CE/CS/WS each get one Moodle course per batch; subgroups resolve via group_id. student.batch_id + student.group_id → deterministic Moodle course lookup.';

CREATE INDEX IF NOT EXISTS idx_batch_moodle_batch_id ON batch_moodle_courses (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_moodle_group_id ON batch_moodle_courses (group_id);
CREATE INDEX IF NOT EXISTS idx_batch_moodle_active   ON batch_moodle_courses (active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_batch_moodle_courses_updated_at'
  ) THEN
    CREATE TRIGGER trg_batch_moodle_courses_updated_at
      BEFORE UPDATE ON batch_moodle_courses
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;


-- =============================================================
-- 4. RLS — is_superadmin() helper
-- =============================================================
-- Used by batch write policies. Checks the admin_users table for the
-- current authenticated user. SECURITY DEFINER so the function can
-- read admin_users regardless of calling user's RLS context.
-- If admin_users does not exist, returns FALSE (safe default).

CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_result BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.admin_users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND role = ''superadmin'')' INTO v_result;
  END IF;
  RETURN v_result;
END;
$$;


-- =============================================================
-- 5. Restrict batches writes to superadmin
-- =============================================================
-- Replace the open authenticated policies from 003_rls_policies.sql
-- with superadmin-gated equivalents.

DROP POLICY IF EXISTS batches_staff_insert ON batches;
DROP POLICY IF EXISTS batches_staff_update ON batches;
DROP POLICY IF EXISTS batches_staff_delete ON batches;

CREATE POLICY batches_superadmin_insert ON batches
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());

CREATE POLICY batches_superadmin_update ON batches
  FOR UPDATE TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

CREATE POLICY batches_superadmin_delete ON batches
  FOR DELETE TO authenticated
  USING (is_superadmin());


-- =============================================================
-- 6. RLS for batch_moodle_courses
-- =============================================================

ALTER TABLE batch_moodle_courses ENABLE ROW LEVEL SECURITY;

-- All authenticated staff can read (needed for teacher availability UI)
CREATE POLICY batch_moodle_staff_select ON batch_moodle_courses
  FOR SELECT TO authenticated USING (true);

-- anon can read active mappings (for public Moodle link resolution)
CREATE POLICY batch_moodle_anon_select ON batch_moodle_courses
  FOR SELECT TO anon USING (active = true);

-- Only superadmin can write
CREATE POLICY batch_moodle_superadmin_insert ON batch_moodle_courses
  FOR INSERT TO authenticated WITH CHECK (is_superadmin());

CREATE POLICY batch_moodle_superadmin_update ON batch_moodle_courses
  FOR UPDATE TO authenticated
  USING (is_superadmin()) WITH CHECK (is_superadmin());

CREATE POLICY batch_moodle_superadmin_delete ON batch_moodle_courses
  FOR DELETE TO authenticated USING (is_superadmin());

COMMIT;

-- ===== END 004_batch_management.sql =====


-- ===== BEGIN 005_add_applicants_availability.sql =====

alter table public.applicants
add column if not exists availability text;


-- ===== END 005_add_applicants_availability.sql =====


-- ===== BEGIN 006_notification_system.sql =====

begin;

create extension if not exists pgcrypto;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  applicant_id uuid null,
  email text null,
  fellowship_code text null,
  class_option_id text null,
  batch_id text null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  template_key text not null,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid null references public.notification_events(id) on delete set null,
  applicant_id uuid null,
  recipient_email text not null,
  event_type text not null,
  template_key text not null,
  scheduled_for timestamptz not null default now(),
  status text not null default 'PENDING',
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text null,
  sent_at timestamptz null,
  last_error text null,
  error_message text null,
  max_attempts integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applicant_notification_state (
  applicant_id uuid primary key,
  notification_state text not null default 'PENDING_SELECTION',
  counters jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  last_event_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  template_key text primary key,
  subject text not null,
  body_html text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists scheduled_notifications_dedupe_key_uq
  on public.scheduled_notifications(dedupe_key)
  where dedupe_key is not null;

create index if not exists notification_events_event_type_idx
  on public.notification_events(event_type);

create index if not exists notification_events_applicant_id_idx
  on public.notification_events(applicant_id);

create index if not exists scheduled_notifications_status_idx
  on public.scheduled_notifications(status);

create index if not exists scheduled_notifications_scheduled_for_idx
  on public.scheduled_notifications(scheduled_for);

create index if not exists scheduled_notifications_recipient_email_idx
  on public.scheduled_notifications(recipient_email);

create index if not exists scheduled_notifications_event_type_idx
  on public.scheduled_notifications(event_type);

create index if not exists scheduled_notifications_applicant_id_idx
  on public.scheduled_notifications(applicant_id);

create index if not exists notification_rules_event_type_idx
  on public.notification_rules(event_type);

create index if not exists applicant_notification_state_state_idx
  on public.applicant_notification_state(notification_state);

create or replace function public.set_notification_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notification_rules_updated_at on public.notification_rules;
create trigger trg_notification_rules_updated_at
before update on public.notification_rules
for each row execute function public.set_notification_updated_at();

drop trigger if exists trg_scheduled_notifications_updated_at on public.scheduled_notifications;
create trigger trg_scheduled_notifications_updated_at
before update on public.scheduled_notifications
for each row execute function public.set_notification_updated_at();

drop trigger if exists trg_applicant_notification_state_updated_at on public.applicant_notification_state;
create trigger trg_applicant_notification_state_updated_at
before update on public.applicant_notification_state
for each row execute function public.set_notification_updated_at();

drop trigger if exists trg_notification_templates_updated_at on public.notification_templates;
create trigger trg_notification_templates_updated_at
before update on public.notification_templates
for each row execute function public.set_notification_updated_at();

alter table public.notification_events enable row level security;
alter table public.notification_rules enable row level security;
alter table public.scheduled_notifications enable row level security;
alter table public.applicant_notification_state enable row level security;
alter table public.notification_templates enable row level security;

drop policy if exists "notification_events_authenticated_select" on public.notification_events;
create policy "notification_events_authenticated_select"
on public.notification_events
for select
to authenticated
using (true);

drop policy if exists "notification_rules_authenticated_select" on public.notification_rules;
create policy "notification_rules_authenticated_select"
on public.notification_rules
for select
to authenticated
using (true);

drop policy if exists "scheduled_notifications_authenticated_select" on public.scheduled_notifications;
create policy "scheduled_notifications_authenticated_select"
on public.scheduled_notifications
for select
to authenticated
using (true);

drop policy if exists "applicant_notification_state_authenticated_select" on public.applicant_notification_state;
create policy "applicant_notification_state_authenticated_select"
on public.applicant_notification_state
for select
to authenticated
using (true);

drop policy if exists "notification_templates_authenticated_select" on public.notification_templates;
create policy "notification_templates_authenticated_select"
on public.notification_templates
for select
to authenticated
using (true);

insert into public.notification_rules (event_type, template_key, priority, active)
values
  ('REGISTRATION_RECEIVED', 'foundation_welcome', 100, true),
  ('NO_CLASS_AVAILABLE', 'no_class_available', 100, true),
  ('NO_SUITABLE_TIME', 'no_suitable_times', 100, true),
  ('CLASS_ASSIGNED', 'class_assigned', 100, true),
  ('DUPLICATE_REGISTRATION', 'duplicate_registration', 100, true),
  ('CLASS_REMINDER_7_DAY', 'class_reminder_7_day', 100, true),
  ('CLASS_REMINDER_1_DAY', 'class_reminder_1_day', 100, true),
  ('CLASS_REMINDER_2_HOUR', 'class_reminder_2_hour', 100, true)
on conflict do nothing;

insert into public.notification_templates (template_key, subject, body_html, active)
values
  ('foundation_welcome', 'Welcome to Foundation School', '<p>Welcome to Foundation School.</p>', true),
  ('no_class_available', 'Class options are not available yet', '<p>We will notify you when classes open.</p>', true),
  ('no_suitable_times', 'We will notify you when more class times open', '<p>We received your availability preference.</p>', true),
  ('class_assigned', 'Your class has been assigned', '<p>Your class assignment is ready.</p>', true),
  ('duplicate_registration', 'We received your additional registration', '<p>We received your additional submission.</p>', true),
  ('class_reminder_7_day', 'Reminder: class starts in 7 days', '<p>Your class starts in 7 days.</p>', true),
  ('class_reminder_1_day', 'Reminder: class starts tomorrow', '<p>Your class starts tomorrow.</p>', true),
  ('class_reminder_2_hour', 'Reminder: class starts in 2 hours', '<p>Your class starts in 2 hours.</p>', true)
on conflict (template_key) do update
set subject = excluded.subject,
    body_html = excluded.body_html,
    active = excluded.active,
    updated_at = now();

commit;


-- ===== END 006_notification_system.sql =====

-- END OF SQUASHED BASELINE
