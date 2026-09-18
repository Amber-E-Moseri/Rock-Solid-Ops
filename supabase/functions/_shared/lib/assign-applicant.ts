export type AssignTriggeredBy = "admin" | "processor" | "waitlist" | "registration";

type AnyClient = any;

export type AssignResult = {
  studentId: string;
  classId: string;
  batchId: string;
};

function fullName(applicant: Record<string, any>) {
  const direct = String(applicant?.full_name || "").trim();
  if (direct) return direct;
  const joined = [applicant?.first_name, applicant?.last_name].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  return joined || "Student";
}

function firstName(value: string) {
  return String(value || "Student").split(/\s+/)[0] || "Student";
}

async function resolveClassSlot(db: AnyClient, classOptionId: string, batchId: string) {
  const { data, error } = await db
    .from("class_slots")
    .select("class_slot_id,current_enrolment,max_capacity,status,batch_id")
    .eq("class_option_id", classOptionId)
    .eq("batch_id", batchId)
    .eq("status", "Active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findActiveBatchId(db: AnyClient): Promise<string> {
  const { data, error } = await db
    .from("batches")
    .select("batch_id")
    .or("active.eq.true,registration_open.eq.true")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const batchId = String(data?.batch_id || "").trim();
  if (!batchId) throw new Error("No active batch found");
  return batchId;
}

async function insertAudit(db: AnyClient, payload: Record<string, unknown>) {
  const { error } = await db.from("audit_logs").insert(payload);
  if (!error) return;
  await db.from("audit_log").insert({
    action: payload.action,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    changed_by: payload.actor_email,
    notes: JSON.stringify(payload.details || {}),
  });
}

export async function assignApplicant(
  applicantId: string,
  classOptionId: string,
  db: AnyClient,
  context: {
    batchId?: string;
    triggeredBy: AssignTriggeredBy;
    actorEmail?: string;
  },
): Promise<AssignResult> {
  const applicantIdClean = String(applicantId || "").trim();
  const classOptionIdClean = String(classOptionId || "").trim();
  if (!applicantIdClean) throw new Error("Missing applicantId");
  if (!classOptionIdClean) throw new Error("Missing classOptionId");

  const { data: applicant, error: applicantErr } = await db
    .from("applicants")
    .select("id,full_name,first_name,last_name,email,phone,group_id,subgroup_id,fellowship_code,batch_id,class_option_id,registration_status")
    .eq("id", applicantIdClean)
    .maybeSingle();
  if (applicantErr) throw applicantErr;
  if (!applicant) throw new Error(`Applicant not found: ${applicantIdClean}`);

  const { data: classOption, error: classErr } = await db
    .from("class_options")
    .select("class_option_id,teacher_id,teacher_name,group_id,subgroup_id,active,enrollment_open")
    .eq("class_option_id", classOptionIdClean)
    .maybeSingle();
  if (classErr) throw classErr;
  if (!classOption) throw new Error(`Invalid class option: ${classOptionIdClean}`);

  const batchId = String(context?.batchId || applicant.batch_id || "").trim() || await findActiveBatchId(db);

  const slot = await resolveClassSlot(db, classOptionIdClean, batchId);
  // slot is null when no class_slots record exists for this class+batch.
  // The old condition used slot?.max_capacity (undefined) !== null (true), then accessed
  // slot.current_enrolment on a null reference. Guard with slot != null first.
  if (slot != null && slot.max_capacity != null && Number(slot.current_enrolment || 0) >= Number(slot.max_capacity)) {
    throw new Error(`Class is full for class_option_id=${classOptionIdClean} batch_id=${batchId}`);
  }

  const assignedAt = new Date().toISOString();
  const updateApplicantPayload = {
    registration_status: "ASSIGNED",
    status: "Enrolled",
    availability_status: "CLASS_ASSIGNED",
    class_option_id: classOptionIdClean,
    batch_id: batchId,
    group_id: String(applicant.group_id || classOption.group_id || "").trim() || null,
    subgroup_id: String(applicant.subgroup_id || classOption.subgroup_id || "").trim() || null,
    assigned_at: assignedAt,
    updated_at: assignedAt,
  };
  const { error: updateAppErr } = await db.from("applicants").update(updateApplicantPayload).eq("id", applicantIdClean);
  if (updateAppErr) throw updateAppErr;

  const studentId = String(applicant.id);
  const studentPayload = {
    student_id: studentId,
    full_name: fullName(applicant),
    email: String(applicant.email || "").trim().toLowerCase(),
    phone: applicant.phone || null,
    group_id: updateApplicantPayload.group_id,
    subgroup_id: updateApplicantPayload.subgroup_id,
    fellowship_code: String(applicant.fellowship_code || "").trim() || null,
    batch_id: batchId,
    class_option_id: classOptionIdClean,
    teacher_id: String(classOption.teacher_id || "").trim() || null,
    teacher_name: String(classOption.teacher_name || "").trim() || null,
    status: "Active",
    updated_at: assignedAt,
  };

  const { error: studentErr } = await db.from("students").upsert({ ...studentPayload, created_at: assignedAt }, { onConflict: "student_id" });
  if (studentErr) throw studentErr;

  const rosterPayload = {
    student_id: studentId,
    class_option_id: classOptionIdClean,
    batch_id: batchId,
    group_id: updateApplicantPayload.group_id,
    subgroup_id: updateApplicantPayload.subgroup_id,
    status: "Active",
    enrolled_at: assignedAt,
    updated_at: assignedAt,
    created_at: assignedAt,
  };
  const { error: rosterErr } = await db.from("class_roster").upsert(rosterPayload, { onConflict: "student_id,class_option_id,batch_id" });
  if (rosterErr) throw rosterErr;

  const dedupeKey = `moodle-enroll:${applicantIdClean}`;
  const moodlePayload = {
    dedupe_key: dedupeKey,
    applicant_id: applicantIdClean,
    registration_id: applicantIdClean,
    student_id: studentId,
    email: String(applicant.email || "").trim().toLowerCase(),
    full_name: fullName(applicant),
    batch_id: batchId,
    class_option_id: classOptionIdClean,
    registration_status: "ASSIGNED",
    sync_status: "PENDING",
    status: "PENDING",
    payload: {
      applicant_id: applicantIdClean,
      class_option_id: classOptionIdClean,
      batch_id: batchId,
      triggered_by: context.triggeredBy,
    },
    retry_requested_at: assignedAt,
    updated_at: assignedAt,
  };
  const { error: moodleErr } = await db.from("moodle_enrollment_sync").upsert(moodlePayload, { onConflict: "dedupe_key" });
  if (moodleErr) throw moodleErr;

  const emailPayload = {
    recipient_email: String(applicant.email || "").trim().toLowerCase(),
    recipient_name: fullName(applicant),
    template_key: "foundation_welcome",
    subject: "Welcome to Foundation School",
    status: "Pending",
    payload: {
      first_name: firstName(fullName(applicant)),
      full_name: fullName(applicant),
      email: String(applicant.email || "").trim().toLowerCase(),
      class_option_id: classOptionIdClean,
      batch_id: batchId,
      teacher_name: studentPayload.teacher_name,
    },
    created_at: assignedAt,
  };
  const { error: emailErr } = await db.from("email_queue").insert(emailPayload);
  if (emailErr) throw emailErr;

  if (slot?.class_slot_id) {
    const { error: slotErr } = await db
      .from("class_slots")
      .update({ current_enrolment: Number(slot.current_enrolment || 0) + 1, updated_at: assignedAt })
      .eq("class_slot_id", slot.class_slot_id);
    if (slotErr) throw slotErr;
  }

  await insertAudit(db, {
    actor_email: context.actorEmail || `${context.triggeredBy}@system`,
    action: "APPLICANT_ASSIGNED",
    entity_type: "applicant",
    entity_id: applicantIdClean,
    status: "SUCCESS",
    details: {
      applicant_id: applicantIdClean,
      student_id: studentId,
      class_option_id: classOptionIdClean,
      batch_id: batchId,
      triggered_by: context.triggeredBy,
    },
    logged_at: assignedAt,
  });

  return {
    studentId,
    classId: classOptionIdClean,
    batchId,
  };
}
