export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_TEACHER_MAPPING"
  | "TEACHER_NOT_ACTIVE"
  | "UNAUTHORIZED_CLASS_ACCESS"
  | "INVALID_PAYLOAD"
  | "REQUEST_TIMEOUT"
  | "ATTENDANCE_SUBMIT_HELD"
  | "AVAILABILITY_WRITE_FORBIDDEN"
  | "APPROVAL_HELD"
  | "INTERNAL_ERROR";

export interface TeacherContext {
  teacherId: string;
  fullName: string;
  email: string;
}

export interface AuthContext {
  user: { id: string; email?: string | null };
  teacher: TeacherContext;
  role: string;
  teacherMapped: boolean;
}

export interface WriteAuditInput {
  action: string;
  actorEmail?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
  details?: Record<string, unknown>;
}

export interface ActionContext {
  db: any;
  auth: AuthContext;
  params: any;
}
