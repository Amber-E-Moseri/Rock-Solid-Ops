import { ApiError } from "./errors.ts";

// Server-side mirror of foundation-spa/src/releaseHolds.js ATTENDANCE_SUBMIT_CERTIFIED.
// The SPA flag only disables the buttons. Direct API calls bypass it, so the attendance submit actions
// refuse here, before any database read or write, audit write or external call. Keep this false until the
// submit path is certified against the staging contract, and change both files together.
export const ATTENDANCE_SUBMIT_CERTIFIED = false;

export const ATTENDANCE_SUBMIT_HELD_CODE = "ATTENDANCE_SUBMIT_HELD";
export const ATTENDANCE_SUBMIT_HELD_STATUS = 423;
export const ATTENDANCE_SUBMIT_HELD_MESSAGE =
  "Attendance submission is on hold pending certification. Nothing has been saved.";

export function assertAttendanceSubmitCertified(certified: boolean = ATTENDANCE_SUBMIT_CERTIFIED): void {
  if (!certified) {
    throw new ApiError("ATTENDANCE_SUBMIT_HELD", ATTENDANCE_SUBMIT_HELD_MESSAGE, ATTENDANCE_SUBMIT_HELD_STATUS);
  }
}
