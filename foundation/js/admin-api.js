(function attachAdminApi(global){
  const FSAdminApi = {
    getConfig() {
      const cfg = global.FSConfig?.get ? global.FSConfig.get() : {
        SUPABASE_URL: String(global.FS_CONFIG?.SUPABASE_URL || '').trim(),
        SUPABASE_ANON_KEY: String(global.FS_CONFIG?.SUPABASE_ANON_KEY || '').trim()
      };
      const url = String(cfg.SUPABASE_URL || '').trim();
      const anonKey = String(cfg.SUPABASE_ANON_KEY || '').trim();
      return { url, anonKey, unresolved: !url || !anonKey };
    },
    headers(anonKey, extra) {
      const base = {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      };
      return extra ? { ...base, ...extra } : base;
    },
    async supabaseGet(url, anonKey, table, params) {
      const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
        headers: FSAdminApi.headers(anonKey)
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async supabasePatch(url, anonKey, table, params, body) {
      const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
        method: 'PATCH',
        headers: FSAdminApi.headers(anonKey, { Prefer: 'return=representation' }),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async supabasePost(url, anonKey, table, body, prefer) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: FSAdminApi.headers(anonKey, { Prefer: prefer || 'return=representation' }),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    normalizeError(err) {
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      return String(err.message || err);
    },
    classifyEdgeError(err) {
      const text = String(err?.message || err || "Unknown error");
      const lower = text.toLowerCase();
      if (lower.includes("timeout") || lower.includes("timed out")) return { code: "TIMEOUT", message: text, retryable: true };
      if (lower.includes("network") || lower.includes("fetch") || lower.includes("ecconn")) return { code: "NETWORK", message: text, retryable: true };
      if (lower.includes("invalid session") || lower.includes("auth") || lower.includes("jwt")) return { code: "AUTH", message: text, retryable: false };
      if (lower.includes("permission") || lower.includes("access denied")) return { code: "PERMISSION", message: text, retryable: false };
      return { code: "UNKNOWN", message: text, retryable: true };
    },
    normalizeTeacherStatus(status, active) {
      const raw = String(status || "").trim().toUpperCase();
      if (raw === "PENDING" || raw === "ACTIVE" || raw === "SUSPENDED" || raw === "INACTIVE") {
        return raw;
      }
      if (raw === "APPROVED") return "ACTIVE";
      if (raw === "REJECTED") return "INACTIVE";
      if (raw === "SUSPENDEDCONFIRMED") return "SUSPENDED";
      return active === true ? "ACTIVE" : "INACTIVE";
    },
    async listTeachers(client, opts) {
      const status = String(opts?.status || "ALL").toUpperCase();
      let query = client
        .from("teachers")
        .select("teacher_id,full_name,email,phone,group_id,subgroup_id,fellowship_code,status,active,notes,created_at,updated_at,suspended_at,suspended_reason,suspended_by,deactivated_at,deactivated_reason,deactivated_by,rejected_at,rejected_reason,activated_at,activated_by,teacher_user_id,deleted_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (status !== "ALL") {
        query = query.eq("status", status);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    async logTeacherAudit(client, eventType, teacherId, details, actorEmail) {
      const payload = {
        action: eventType,
        event_type: eventType,
        entity_type: "teacher",
        entity_id: teacherId,
        status: "SUCCESS",
        actor: actorEmail || null,
        actor_email: actorEmail || null,
        changed_by: actorEmail || null,
        details: details || {},
        notes: details ? JSON.stringify(details) : null,
        logged_at: new Date().toISOString()
      };
      await client.from("audit_logs").insert(payload);
    },
    async updateTeacherStatus(client, teacherId, nextStatus, actorEmail, reason) {
      const status = String(nextStatus || "").toUpperCase();
      const nowIso = new Date().toISOString();
      const patch = { status, active: status === "ACTIVE", updated_at: nowIso };
      if (status === "ACTIVE") {
        patch.activated_at = nowIso;
        patch.deactivated_at = null;
        patch.rejected_at = null;
        patch.suspended_at = null;
        patch.suspended_reason = null;
      } else if (status === "SUSPENDED") {
        patch.suspended_at = nowIso;
        patch.suspended_reason = reason || null;
      } else if (status === "INACTIVE") {
        patch.deactivated_at = nowIso;
      }
      const { data, error } = await client
        .from("teachers")
        .update(patch)
        .eq("teacher_id", teacherId)
        .is("deleted_at", null)
        .select("teacher_id,full_name,email,status,active")
        .single();
      if (error) throw error;
      return data;
    },
    async invokeRetryWorker(client, payload) {
      const { data, error } = await client.functions.invoke("retry-worker", {
        body: payload
      });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(String(data?.error || "retry-worker call failed"));
      }
      return data;
    },
    async invokeMoodleSync(client, payload) {
      // Route through admin-api proxy for authenticated access.
      // Remap moodle-sync "action" param to avoid conflict with admin-api "action" field.
      const body = { action: "invoke-moodle-sync" };
      if (payload?.action) {
        body.moodle_action = payload.action;
      }
      if (payload?.id) {
        body.id = payload.id;
      }
      if (payload?.limit) {
        body.limit = payload.limit;
      }

      const { data, error } = await client.functions.invoke("admin-api", { body });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(String(data?.error || "moodle-sync call failed"));
      }
      return data;
    },
    async logAuditEvent(client, payload) {
      const base = {
        action: payload?.action || "UNKNOWN_EVENT",
        event_type: payload?.action || "UNKNOWN_EVENT",
        entity_type: payload?.entity_type || "system",
        entity_id: payload?.entity_id || null,
        status: payload?.status || "SUCCESS",
        actor: payload?.actor_email || null,
        actor_email: payload?.actor_email || null,
        changed_by: payload?.actor_email || null,
        details: payload?.details || {},
        notes: payload?.details ? JSON.stringify(payload.details) : null,
        logged_at: new Date().toISOString()
      };
      const { error } = await client.from("audit_logs").insert(base);
      return !error;
    },
    async ensureClassOptionForAvailability(client, args) {
      const teacherId = String(args?.teacherId || "").trim();
      const subgroupId = String(args?.subgroupId || "").trim();
      const groupId = String(args?.groupId || "").trim();
      const batchId = String(args?.batchId || "").trim();
      const day = String(args?.day || "").trim();
      const timeSlot = String(args?.timeSlot || "").trim();
      const teacherName = String(args?.teacherName || "").trim();
      const actorEmail = String(args?.actorEmail || "").trim() || null;
      if (!teacherId) throw new Error("Missing teacher_id");
      if (!subgroupId) throw new Error("Missing subgroup_id");
      if (!groupId) throw new Error("Missing group_id");
      if (!batchId) throw new Error("Missing batch_id");
      if (!day) throw new Error("Missing day");
      if (!timeSlot) throw new Error("Missing time_slot");

      const d = day.substring(0, 3).toUpperCase();
      const t = timeSlot.replace(":", "").substring(0, 4);
      const tid = teacherId.replace(/[^A-Za-z0-9]/g, "").substring(0, 8).toUpperCase();
      const sg = subgroupId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const deterministicId = `CO-${sg}-${d}-${t}-${tid}`;

      const { data: naturalMatch, error: naturalErr } = await client
        .from("class_options")
        .select("class_option_id")
        .is("deleted_at", null)
        .eq("teacher_id", teacherId)
        .eq("group_id", groupId)
        .eq("subgroup_id", subgroupId)
        .eq("day", day)
        .eq("class_time", timeSlot)
        .limit(1)
        .maybeSingle();
      if (naturalErr) throw naturalErr;

      const classOptionId = String(naturalMatch?.class_option_id || deterministicId);
      // INVARIANT: After this step, at least one class_options row must exist
      // for batch_id + class_option_id. If missing, audit and throw — do not proceed.
      const upsertPayload = {
        class_option_id: classOptionId,
        class_id: classOptionId,
        teacher_id: teacherId,
        teacher_name: teacherName || null,
        fellowship_codes: [subgroupId],
        group_id: groupId,
        subgroup_id: subgroupId,
        day,
        class_time: timeSlot,
        active: true,
        enrollment_open: true,
        updated_by: actorEmail
      };

      const { data: existing, error: existingErr } = await client
        .from("class_options")
        .select("class_option_id")
        .eq("class_option_id", classOptionId)
        .maybeSingle();
      if (existingErr) throw existingErr;
      const wasExisting = !!existing;

      const { error: upsertErr } = await client
        .from("class_options")
        .upsert(upsertPayload, { onConflict: "class_option_id" });
      if (upsertErr) {
        throw new Error(`CLASS_OPTIONS insert failed: ${String(upsertErr.message || upsertErr)}`);
      }

      const { count, error: persistedErr } = await client
        .from("class_options")
        .select("*", { count: "exact", head: true })
        .eq("class_option_id", classOptionId)
        .eq("group_id", groupId)
        .eq("subgroup_id", subgroupId);
      if (persistedErr) throw persistedErr;
      if (!count || count === 0) {
        const reviewDetails = {
          applicant_id: String(args?.applicantId || "").trim() || null,
          approval_action: "ensureClassOptionForAvailability",
          batch_id: batchId,
          class_option_id: classOptionId,
          teacher_id: teacherId,
          subgroup_id: subgroupId,
          source: "approval_flow",
        };
        await client.from("audit_logs").insert({
          action: "CLASS_OPTIONS_MISSING_AFTER_APPROVAL",
          entity_type: "applicant",
          entity_id: reviewDetails.applicant_id || classOptionId,
          status: "FAILED",
          details: reviewDetails,
          logged_at: new Date().toISOString()
        });
        throw new Error(`CLASS_OPTIONS invariant violated: no row exists after insert for applicant ${reviewDetails.applicant_id || "(unknown)"}`);
      }

      return {
        class_option_id: classOptionId,
        action: wasExisting ? "updated" : "created"
      };
    }
  };

  global.FSAdminApi = FSAdminApi;
})(window);
