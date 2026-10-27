import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, parseDate, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { assertClassOwnership } from "../_lib/class-ownership.ts";
import { safeLogAudit, writeAudit } from "../_lib/teacher-auth.ts";
import { assertAvailabilityApprovalCertified } from "../_lib/approval-hold.ts";


export async function approveAvailabilityAction(ctx: ActionContext): Promise<Response> {
  // Refuse before any database read, write, audit or external call while availability approval is uncertified.
  assertAvailabilityApprovalCertified();
  const { db, auth, params } = ctx;
      // INVARIANT: After this step, at least one class_options row must exist
      // for batch_id + class_option_id. If missing, audit and throw — do not proceed.
      async function ensureClassOptionPersisted(classOptionId: string, pathLabel: string) {
        const normalized = String(classOptionId || "").trim();
        if (!normalized) {
          throw new ApiError(
            "INTERNAL_ERROR",
            `${rpcName}: approval completed but no class_option_id was returned (${pathLabel})`,
            500,
          );
        }

        const classOptionRes = await withTimeout(
          db
            .from("class_options")
            .select("class_option_id")
            .eq("class_option_id", normalized)
            .maybeSingle(),
          "verify class_options row after approval",
        );

        if (classOptionRes.error || !classOptionRes.data) {
          try {
            await db.from("failed_syncs").insert({
              source_table: "teacher_availability",
              source_id: availabilityId,
              sync_type: "class_options",
              status: "FAILED",
              error_message: classOptionRes.error?.message || "class_options row missing after approval",
              retry_count: 0,
              last_retry_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } catch (_) {
            // best-effort visibility in Retry Center
          }
          await safeLogAudit(db, {
            action: "CLASS_OPTIONS_MISSING_AFTER_APPROVAL",
            actorEmail: auth.teacher.email,
            actorId: auth.user.id,
            entityType: "applicant",
            entityId: normalized,
            status: "FAILED",
            details: {
              applicant_id: null,
              approval_action: rpcName,
              availability_id: availabilityId,
              path: pathLabel,
              reason: classOptionRes.error?.message || "class_options row missing after approval",
            },
          });
          throw new ApiError(
            "INTERNAL_ERROR",
            `${rpcName}: approval completed but CLASS_OPTIONS row is missing for class_option_id=${normalized}`,
            500,
          );
        }

        return normalized;
      }

      const rpcName = "approve_teacher_availability_atomic";
      const availabilityId = String(params.availabilityId || params.id || "").trim();
      if (!availabilityId) throw new ApiError("INVALID_PAYLOAD", "availabilityId is required", 400);

      const rpcRes = await withTimeout(
        db.rpc(rpcName, {
          p_availability_id: availabilityId,
          p_actor_email: auth.teacher.email || null,
          p_actor_id: auth.user.id || null,
        }),
        "approve availability rpc",
      );

      if (rpcRes.error) {
        const message = String(rpcRes.error.message || "Approval RPC failed").trim();
        const reason = `${rpcName}: ${message}`;
        const mappingConstraintFailure =
          message.toLowerCase().includes("batch_moodle_courses") &&
          (message.toLowerCase().includes("group_id") || message.toLowerCase().includes("chk_batch_moodle_group_id"));

        if (mappingConstraintFailure) {
          const verifyRes = await withTimeout(
            db
              .from("teacher_availability")
              .select("class_option_id,teacher_id,batch_id,status")
              .eq("id", availabilityId)
              .maybeSingle(),
            "verify availability after mapping failure",
          );
          const classOptionId = String(verifyRes.data?.class_option_id || "").trim();
          if (classOptionId) {
            const verifiedClassOptionId = await ensureClassOptionPersisted(classOptionId, "mapping_constraint_recovery");
            await safeLogAudit(db, {
              action: "TEACHER_AVAIL_MOODLE_MAPPING_SKIPPED",
              actorEmail: auth.teacher.email,
              actorId: auth.user.id,
              entityType: "teacher_availability",
              entityId: availabilityId,
              status: "WARN",
              details: {
                rpc: rpcName,
                reason,
                warning: "Skipped batch_moodle_courses mapping due to missing/invalid teacher group_id",
                class_option_id: verifiedClassOptionId,
                class_slot_id: null,
                teacher_id: verifyRes.data?.teacher_id || null,
                batch_id: verifyRes.data?.batch_id || null,
                availability_status: verifyRes.data?.status || null,
              },
            });
            return json({
              ok: true,
              data: {
                availabilityId,
                classOptionId: verifiedClassOptionId,
                classSlotId: null,
                warning: "Moodle mapping skipped due to missing/invalid teacher group_id",
              },
            });
          }
        }

        await safeLogAudit(db, {
          action: "TEACHER_AVAIL_APPROVAL_FAILED",
          actorEmail: auth.teacher.email,
          actorId: auth.user.id,
          entityType: "teacher_availability",
          entityId: availabilityId,
          status: "FAILED",
          details: { rpc: rpcName, reason },
        });
        throw new ApiError("INTERNAL_ERROR", reason, 500);
      }

      const result = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
      if (!result?.ok) {
        const message = String(result?.error || "Approval failed").trim();
        const reason = `${rpcName}: ${message}`;
        await safeLogAudit(db, {
          action: "TEACHER_AVAIL_APPROVAL_FAILED",
          actorEmail: auth.teacher.email,
          actorId: auth.user.id,
          entityType: "teacher_availability",
          entityId: availabilityId,
          status: "FAILED",
          details: {
            rpc: rpcName,
            reason,
            class_option_id: result?.class_option_id || null,
            class_slot_id: result?.class_slot_id || null,
          },
        });
        const status = message.toLowerCase().includes("only superadmin") ? 403 : 400;
        throw new ApiError("INVALID_PAYLOAD", reason, status);
      }

      const verifiedClassOptionId = await ensureClassOptionPersisted(
        result.class_option_id,
        "rpc_success",
      );

      await safeLogAudit(db, {
        action: "TEACHER_AVAIL_APPROVED",
        actorEmail: auth.teacher.email,
        actorId: auth.user.id,
        entityType: "teacher_availability",
        entityId: availabilityId,
        status: "ok",
        details: {
          class_option_id: verifiedClassOptionId,
          class_slot_id: result.class_slot_id || null,
        },
      });

      return json({
        ok: true,
        data: {
          availabilityId,
          classOptionId: verifiedClassOptionId,
          classSlotId: result.class_slot_id || null,
        },
      });
    }
