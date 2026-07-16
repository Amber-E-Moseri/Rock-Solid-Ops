import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, parseDate, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { assertClassOwnership } from "../_lib/class-ownership.ts";
import { safeLogAudit, writeAudit } from "../_lib/teacher-auth.ts";


export async function submitTeacherAttendanceAction(ctx: ActionContext): Promise<Response> {
  const { db, auth, params } = ctx;
      const classOptionId = String(params.classOptionId || "").trim();
      await assertClassOwnership(db, classOptionId, auth.teacher.teacherId, { email: auth.teacher.email, userId: auth.user.id });

      const classSession = String(params.classSession || "").trim();
      const classDate = parseDate(params.classDate);
      const records = Array.isArray(params.records) ? params.records : [];
      const guestRecords = Array.isArray(params.guestRecords) ? params.guestRecords : [];

      const classSessions = classSession
        .split(",")
        .map((s) => String(s || "").replace(/^Class/i, "").trim())
        .filter(Boolean);
      if (!classSessions.length) throw new ApiError("INVALID_PAYLOAD", "classSession is required", 400);
      const firstSubmissionMeta = params.firstSubmissionMeta && typeof params.firstSubmissionMeta === "object"
        ? params.firstSubmissionMeta
        : null;

      const eligibleRecords = records.filter((r) => r && r.studentId);
      const allStudentIdsFromPayload = Array.isArray(params.allStudentIds) ? params.allStudentIds : [];
      const allStudentIds = [...new Set(
        (allStudentIdsFromPayload.length ? allStudentIdsFromPayload : eligibleRecords.map((r) => r.studentId))
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      )];
      const presentStudentIds = eligibleRecords
        .filter((r) => String(r.attendanceStatus || "").toLowerCase() === "present")
        .map((r) => String(r.studentId));
      const presentStudentSet = new Set(presentStudentIds);

      const rosterMetaByStudentId = new Map<string, { group_id: string | null; subgroup_id: string | null; batch_id: string | null }>();
      if (allStudentIds.length) {
        const validStudentsRes = await withTimeout(
          db
            .from("class_roster")
            .select("student_id,class_option_id,status,group_id,subgroup_id,batch_id")
            .in("student_id", allStudentIds)
            .eq("class_option_id", classOptionId)
            .eq("status", "Active"),
          "validate students for attendance",
        );
        if (validStudentsRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to validate students", 500);

        for (const row of validStudentsRes.data || []) {
          rosterMetaByStudentId.set(String(row.student_id), {
            group_id: row.group_id ?? null,
            subgroup_id: row.subgroup_id ?? null,
            batch_id: row.batch_id ?? null,
          });
        }

        const validIds = new Set((validStudentsRes.data || []).map((s) => String(s.student_id)));
        const invalidIds = allStudentIds.filter((id) => !validIds.has(id));
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
          throw new ApiError("UNAUTHORIZED_CLASS_ACCESS", "One or more students are not in your class roster", 403);
        }
      }

      const nowIso = new Date().toISOString();
      const attendanceCountRes = await withTimeout(
        db
          .from("attendance_log")
          .select("attendance_id", { count: "exact", head: true })
          .eq("class_option_id", classOptionId),
        "first submission detection",
      );
      if (attendanceCountRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to detect first submission state", 500);
      const isFirstSubmission = Number(attendanceCountRes.count || 0) === 0;

      const parseYmd = (raw: unknown): string | null => {
        const v = String(raw || "").trim();
        if (!v) return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };
      const dateDiffDays = (fromYmd: string, toYmd: string): number => {
        const from = new Date(`${fromYmd}T00:00:00Z`);
        const to = new Date(`${toYmd}T00:00:00Z`);
        return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      };
      const plusDays = (ymd: string, days: number): string => {
        const d = new Date(`${ymd}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };

      if (isFirstSubmission) {
        const startDateCandidate = firstSubmissionMeta?.actualStartDate ?? params.classDate;
        const startDate = parseYmd(startDateCandidate);
        if (!startDate) {
          throw new ApiError("INVALID_PAYLOAD", "A valid classDate is required for first submission.", 400);
        }

        const activeSlotRes = await withTimeout(
          db
            .from("class_slots")
            .select("batch_id,status,batches(batch_id,start_date,active,status)")
            .eq("class_option_id", classOptionId)
            .limit(10),
          "resolve class batch for late start",
        );
        if (activeSlotRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to resolve class batch", 500);
        const activeSlot = (activeSlotRes.data || []).find((row: any) => {
          const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
          const batchActive = batch?.active === true || String(batch?.status || "").toUpperCase() === "ACTIVE";
          const slotActive = String(row.status || "").toUpperCase() === "ACTIVE" || !row.status;
          return batchActive && slotActive && String(batch?.start_date || "").trim();
        });
        const batchRef = activeSlot ? (Array.isArray(activeSlot.batches) ? activeSlot.batches[0] : activeSlot.batches) : null;
        const batchStartDate = String(batchRef?.start_date || "").trim();
        if (!batchStartDate) {
          throw new ApiError("INVALID_PAYLOAD", "Unable to determine active batch start date for this class.", 400);
        }

        if (startDate < batchStartDate) {
          throw new ApiError("INVALID_PAYLOAD", "Actual class start date cannot be before batch start date.", 400);
        }
        if (classDate && startDate > classDate) {
          throw new ApiError("INVALID_PAYLOAD", "Actual class start date cannot be after the submitted class date.", 400);
        }

        const confirmedStartRes = await withTimeout(
          db
            .from("class_options")
            .update({
              confirmed_start_date: startDate,
              updated_by: auth.teacher.email,
            })
            .eq("class_option_id", classOptionId),
          "save confirmed class start date",
        );
        if (confirmedStartRes.error) {
          const isMissingConfirmedStartColumn = String(confirmedStartRes.error?.code || "") === "42703" ||
            String(confirmedStartRes.error?.message || "").toLowerCase().includes("confirmed_start_date");
          if (!isMissingConfirmedStartColumn) {
            throw new ApiError("INTERNAL_ERROR", "Failed to save confirmed class start date", 500);
          }
          const fallbackUpdateRes = await withTimeout(
            db
              .from("class_options")
              .update({
                updated_by: auth.teacher.email,
              })
              .eq("class_option_id", classOptionId),
            "save class metadata fallback",
          );
          if (fallbackUpdateRes.error) {
            throw new ApiError("INTERNAL_ERROR", "Failed to save class metadata fallback", 500);
          }
        }

        const missedWeeks = Math.max(0, Math.floor(dateDiffDays(batchStartDate, startDate) / 7));
        if (missedWeeks > 0 && allStudentIds.length > 0) {
          const lateRows = allStudentIds.flatMap((studentId) => {
            const meta = rosterMetaByStudentId.get(studentId);
            return Array.from({ length: missedWeeks }).map((_, idx) => ({
              student_id: studentId,
              group_id: meta?.group_id ?? null,
              subgroup_id: meta?.subgroup_id ?? null,
              batch_id: meta?.batch_id ?? batchRef?.batch_id ?? null,
              class_option_id: classOptionId || null,
              teacher_name: auth.teacher.fullName || null,
              class_number: String(idx + 1),
              class_date: plusDays(batchStartDate, idx * 7),
              present: false,
              submitted_by_teacher: true,
              submission_date: nowIso,
              response_id: "Late start - confirmed by teacher",
            }));
          });
          if (lateRows.length) {
            const lateUpsertRes = await withTimeout(
              db.from("attendance_log").upsert(lateRows, {
                onConflict: "student_id,class_option_id,class_number,class_date",
              }),
              "late start backfill upsert",
            );
            if (lateUpsertRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to save late-start attendance history", 500);
          }
        }
      }

      const inserts = allStudentIds.flatMap((studentId) =>
        classSessions.map((session) => ({
          student_id: studentId,
          // Source group/subgroup/batch from class_roster metadata; keep null if unavailable.
          group_id: rosterMetaByStudentId.get(studentId)?.group_id ?? null,
          subgroup_id: rosterMetaByStudentId.get(studentId)?.subgroup_id ?? null,
          batch_id: rosterMetaByStudentId.get(studentId)?.batch_id ?? null,
          class_option_id: classOptionId || null,
          teacher_name: auth.teacher.fullName || null,
          class_number: session,
          class_date: classDate,
          present: presentStudentSet.has(studentId),
          submitted_by_teacher: true,
          submission_date: nowIso,
        })),
      );

      const dedupe = new Map<string, typeof inserts[number]>();
      for (const row of inserts) {
        // attendance_log dedupe key aligns with DB upsert conflict key.
        const key = `${row.student_id}::${row.class_option_id}::${row.class_number}::${row.class_date || ""}`;
        if (!dedupe.has(key)) dedupe.set(key, row);
      }
      const uniqueInserts = [...dedupe.values()];

      if (uniqueInserts.length) {
        const upsertRes = await withTimeout(
          db.from("attendance_log").upsert(uniqueInserts, {
            onConflict: "student_id,class_option_id,class_number,class_date",
          }),
          "attendance upsert",
        );
        if (upsertRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to save attendance", 500);
      }

      const isClassOneSubmission = classSessions.some((s) => String(s || "").trim() === "1");
      if (isClassOneSubmission) {
        const moodleUrl = String(Deno.env.get("MOODLE_URL") || "https://rocksolid.lwcanada.org").trim();

        const rosterRes = await withTimeout(
          db
            .from("class_roster")
            .select("student_id,batch_id,status")
            .eq("class_option_id", classOptionId)
            .eq("status", "Active"),
          "class one moodle follow-up roster",
        );
        if (!rosterRes.error && (rosterRes.data || []).length) {
          const rosterRows = rosterRes.data || [];
          const studentIds = [...new Set(rosterRows.map((r: any) => String(r.student_id || "").trim()).filter(Boolean))];
          const batchIds = [...new Set(rosterRows.map((r: any) => String(r.batch_id || "").trim()).filter(Boolean))];

          const [studentsRes, classInfoRes] = await Promise.all([
            withTimeout(
              db
                .from("students")
                .select("student_id,email,full_name")
                .in("student_id", studentIds),
              "class one moodle follow-up students",
            ),
            withTimeout(
              db
                .from("class_options")
                .select("class_option_id,day,class_time,teacher_name")
                .eq("class_option_id", classOptionId)
                .maybeSingle(),
              "class one moodle follow-up class info",
            ),
          ]);

          if (!studentsRes.error) {
            const students = studentsRes.data || [];
            const studentById = new Map(students.map((s: any) => [String(s.student_id), s]));
            const emails = [...new Set(students.map((s: any) => String(s.email || "").trim().toLowerCase()).filter(Boolean))];

            if (emails.length && batchIds.length) {
              const [syncRes, applicantsRes] = await Promise.all([
                withTimeout(
                  db
                    .from("moodle_enrollment_sync")
                    .select("email,batch_id,sync_status,moodle_course_id,course_id")
                    .in("email", emails)
                    .in("batch_id", batchIds),
                  "class one moodle follow-up sync rows",
                ),
                withTimeout(
                  db
                    .from("applicants")
                    .select("id,email,batch_id,full_name")
                    .in("email", emails)
                    .in("batch_id", batchIds),
                  "class one moodle follow-up applicants",
                ),
              ]);

              if (!syncRes.error && !applicantsRes.error) {
                const syncMap = new Map<string, any>();
                for (const row of syncRes.data || []) {
                  const key = `${String(row.email || "").trim().toLowerCase()}::${String(row.batch_id || "").trim()}`;
                  syncMap.set(key, row);
                }
                const appMap = new Map<string, any>();
                for (const row of applicantsRes.data || []) {
                  const key = `${String(row.email || "").trim().toLowerCase()}::${String(row.batch_id || "").trim()}`;
                  appMap.set(key, row);
                }

                const classDay = String((classInfoRes.data as any)?.day || "").trim();
                const classTime = String((classInfoRes.data as any)?.class_time || "").trim();
                const teacherName = String((classInfoRes.data as any)?.teacher_name || auth.teacher.fullName || "").trim();
                const classLabel = `${classDay}${classTime ? ` ${classTime}` : ""}`.trim() || "Foundation School Class";
                const scheduledFor = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString();

                const notificationRows: Array<Record<string, unknown>> = [];
                for (const rosterRow of rosterRows) {
                  const studentId = String(rosterRow.student_id || "").trim();
                  const batchId = String(rosterRow.batch_id || "").trim();
                  if (!studentId || !batchId) continue;
                  const student = studentById.get(studentId);
                  const email = String(student?.email || "").trim().toLowerCase();
                  if (!email) continue;
                  const mapKey = `${email}::${batchId}`;
                  const syncRow = syncMap.get(mapKey);
                  if (!syncRow) continue;
                  const syncStatus = String(syncRow.sync_status || "").toUpperCase();
                  const moodleCourseId = String(syncRow.moodle_course_id || syncRow.course_id || "").trim();
                  if (syncStatus !== "SYNCED" || !moodleCourseId) continue;
                  const applicant = appMap.get(mapKey);
                  const applicantId = String(applicant?.id || "").trim();
                  if (!applicantId) continue;

                  notificationRows.push({
                    recipient_email: email,
                    applicant_id: applicantId,
                    batch_id: batchId,
                    event_type: "moodle_login_check",
                    template_key: "moodle_login_reminder",
                    scheduled_for: scheduledFor,
                    status: "PENDING",
                    dedupe_key: `moodle_login_check:${applicantId}:${batchId}`,
                    payload: {
                      class_option_id: classOptionId,
                      class_label: classLabel,
                      teacher_name: teacherName,
                      moodle_url: moodleUrl,
                      class_start_date: classDate || null,
                      email,
                      full_name: String(student?.full_name || applicant?.full_name || "").trim(),
                    },
                  });
                }

                if (notificationRows.length) {
                  const dedupeKeys = notificationRows
                    .map((row) => String(row.dedupe_key || "").trim())
                    .filter(Boolean);
                  const existingRes = await withTimeout(
                    db
                      .from("scheduled_notifications")
                      .select("dedupe_key")
                      .in("dedupe_key", dedupeKeys),
                    "class one moodle follow-up dedupe lookup",
                  );
                  if (existingRes.error) {
                    console.error("CLASS_ONE_MOODLE_LOGIN_CHECK_DEDUPE_LOOKUP_ERROR", existingRes.error);
                  } else {
                    const existingKeys = new Set((existingRes.data || []).map((r: any) => String(r.dedupe_key || "").trim()));
                    const rowsToInsert = notificationRows.filter((row) => !existingKeys.has(String(row.dedupe_key || "").trim()));
                    if (rowsToInsert.length) {
                      const schedRes = await withTimeout(
                        db.from("scheduled_notifications").insert(rowsToInsert),
                        "class one moodle follow-up schedule insert",
                      );
                      if (schedRes.error) {
                        console.error("CLASS_ONE_MOODLE_LOGIN_CHECK_SCHEDULE_ERROR", schedRes.error);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Guest attendance — written to attendance_records (canonical table with guest support).
      // No student_id, no PII lookup; only name is stored. Class ownership already verified above.
      let guestInserted = 0;
      if (guestRecords.length) {
        const guestRows = guestRecords.flatMap((g) => {
          const guestName = String(g.guestName || "").trim().slice(0, 200);
          if (!guestName) return [];
          return classSessions.map((session) => ({
            class_option_id: classOptionId,
            class_number: parseInt(session, 10) || 1,
            class_date: classDate,
            status: "present",
            attendance_type: "guest",
            guest_name: guestName,
            guest_phone: String(g.guestPhone || "").trim().slice(0, 50) || null,
            submitted_by: auth.user.id,
          }));
        });

        if (guestRows.length) {
          const guestDedupe = new Map<string, typeof guestRows[number]>();
          for (const row of guestRows) {
            const key = `${row.class_option_id}::${row.class_number}::${row.class_date}::${row.guest_name}`;
            if (!guestDedupe.has(key)) guestDedupe.set(key, row);
          }
          const guestUpsertRes = await withTimeout(
            db.from("attendance_records").upsert([...guestDedupe.values()], {
              onConflict: "class_option_id,class_number,class_date,guest_name",
            }),
            "guest attendance upsert",
          );
          if (guestUpsertRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to save guest attendance", 500);
          guestInserted = guestDedupe.size;
        }
      }

      await writeAudit(db, {
        action: "ATTENDANCE_SUBMITTED",
        actorEmail: auth.teacher.email,
        actorId: auth.user.id,
        entityType: "class_options",
        entityId: classOptionId,
        status: "ok",
        details: {
          inserted: uniqueInserts.length,
          guestInserted,
          presentStudents: presentStudentIds.length,
          sessions: classSessions,
          classDate,
        },
      });

      return json({ ok: true, data: { inserted: uniqueInserts.length } });
    }
