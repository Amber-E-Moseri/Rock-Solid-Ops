import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, parseDate, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { assertClassOwnership } from "../_lib/class-ownership.ts";
import { safeLogAudit, writeAudit } from "../_lib/teacher-auth.ts";
import { assertAttendanceSubmitCertified } from "../_lib/attendance-submit-hold.ts";


export async function submitSessionOutcomesAction(ctx: ActionContext): Promise<Response> {
  // Refuse before any database read, write, audit or external call while attendance submission is uncertified.
  assertAttendanceSubmitCertified();
  const { db, auth, params } = ctx;
      const classOptionId = String(params.classOptionId || "").trim();
      await assertClassOwnership(db, classOptionId, auth.teacher.teacherId, { email: auth.teacher.email, userId: auth.user.id });

      const entries = Array.isArray(params.entries) ? params.entries : [];
      const classSession = String(params.classSession || "");
      const classDate = parseDate(params.classDate);

      const studentIds = entries.map((e) => String(e?.studentId || "")).filter(Boolean);
      if (studentIds.length) {
        const validStudentsRes = await withTimeout(
          db
            .from("class_roster")
            .select("student_id")
            .in("student_id", studentIds)
            .eq("class_option_id", classOptionId)
            .eq("status", "Active"),
          "validate students for outcomes",
        );
        if (validStudentsRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to validate outcomes students", 500);

        const validIds = new Set((validStudentsRes.data || []).map((s) => String(s.student_id)));
        const invalidIds = studentIds.filter((id) => !validIds.has(id));
        if (invalidIds.length) {
          await writeAudit(db, {
            action: "UNAUTHORIZED_CLASS_ACCESS",
            actorEmail: auth.teacher.email,
            actorId: auth.user.id,
            entityType: "session_outcomes",
            entityId: classOptionId,
            status: "denied",
            details: { invalidStudentIds: invalidIds },
          });
          throw new ApiError("UNAUTHORIZED_CLASS_ACCESS", "One or more outcome entries are outside your class roster", 403);
        }
      }

      const rows = entries.map((e) => ({
        teacher_id: auth.teacher.teacherId,
        class_option_id: classOptionId,
        class_session: classSession,
        class_date: classDate,
        student_id: String(e.studentId || ""),
        person_type: String(e.personType || ""),
        full_name: String(e.fullName || ""),
        email: String(e.email || ""),
        milestone_id: String(e.milestoneId || ""),
        question: String(e.question || ""),
        outcome_result: String(e.outcomeResult || ""),
        submitted: Boolean(params.submitted),
      }));

      const dedupedRows = new Map<string, typeof rows[number]>();
      for (const row of rows) {
        // session_outcomes dedupe key aligns with unique index + upsert conflict key.
        const key = `${row.class_option_id}::${row.class_session}::${row.class_date || ""}::${row.student_id}::${row.milestone_id}`;
        if (!dedupedRows.has(key)) dedupedRows.set(key, row);
      }
      const uniqueRows = [...dedupedRows.values()];

      if (uniqueRows.length) {
        const upsertRes = await withTimeout(
          db.from("session_outcomes").upsert(uniqueRows, {
            onConflict: "class_option_id,class_session,class_date,student_id,milestone_id",
          }),
          "upsert session outcomes",
        );
        if (upsertRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to save session outcomes", 500);
      }

      await writeAudit(db, {
        action: "PROGRESS_UPDATED",
        actorEmail: auth.teacher.email,
        actorId: auth.user.id,
        entityType: "session_outcomes",
        entityId: classOptionId,
        status: "ok",
        details: { saved: uniqueRows.length, classSession, classDate },
      });

      return json({ ok: true, data: { saved: uniqueRows.length } });
    }