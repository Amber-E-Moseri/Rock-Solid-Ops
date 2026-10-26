import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, parseDate, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { assertClassOwnership } from "../_lib/class-ownership.ts";
import { safeLogAudit, writeAudit } from "../_lib/teacher-auth.ts";
import { assertAttendanceSubmitCertified } from "../_lib/attendance-submit-hold.ts";


export async function submitLegacyAttendanceAction(ctx: ActionContext): Promise<Response> {
  // Refuse before any database read, write, audit or external call while attendance submission is uncertified.
  assertAttendanceSubmitCertified();
  const { db, auth, params } = ctx;
      const classOptionId = String(params.classOptionId || "").trim();
      await assertClassOwnership(db, classOptionId, auth.teacher.teacherId, { email: auth.teacher.email, userId: auth.user.id });

      const attendanceRows = Array.isArray(params.attendanceRows) ? params.attendanceRows : [];
      if (!attendanceRows.length) throw new ApiError("INVALID_PAYLOAD", "No attendance rows provided", 400);

      // Validate that all attendance rows belong to this teacher's class
      const studentIds = attendanceRows.map((r) => String(r.student_id || "")).filter(Boolean);
      if (studentIds.length) {
        const validStudentsRes = await withTimeout(
          db
            .from("students")
            .select("student_id")
            .in("student_id", studentIds)
            .eq("class_option_id", classOptionId),
          "validate attendance students",
        );
        if (validStudentsRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to validate students", 500);

        const validIds = new Set((validStudentsRes.data || []).map((s) => String(s.student_id)));
        const invalidIds = studentIds.filter((id) => !validIds.has(id));
        if (invalidIds.length) {
          await writeAudit(db, {
            action: "UNAUTHORIZED_CLASS_ACCESS",
            actorEmail: auth.teacher.email,
            actorId: auth.user.id,
            entityType: "attendance_log",
            entityId: classOptionId,
            status: "denied",
            details: { invalidStudentIds: invalidIds },
          });
          throw new ApiError("UNAUTHORIZED_CLASS_ACCESS", "One or more attendance records are for students not in your class", 403);
        }
      }

      const { error: attErr } = await withTimeout(
        db.from("attendance_log").upsert(attendanceRows, {
          onConflict: "student_id,class_option_id,class_number,class_date",
        }),
        "upsert legacy attendance",
      );
      if (attErr) throw new ApiError("INTERNAL_ERROR", "Failed to save attendance", 500);

      await writeAudit(db, {
        action: "LEGACY_ATTENDANCE_SUBMITTED",
        actorEmail: auth.teacher.email,
        actorId: auth.user.id,
        entityType: "class_options",
        entityId: classOptionId,
        status: "ok",
        details: { upserted: attendanceRows.length },
      });

      return json({ ok: true, data: { upserted: attendanceRows.length } });
    }
