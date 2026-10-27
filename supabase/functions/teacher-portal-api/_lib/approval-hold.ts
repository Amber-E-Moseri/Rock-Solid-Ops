import { ApiError } from "./errors.ts";

// Server-side hold for approveAvailability. Fail-closed default: approval is refused unless this constant is
// changed in code and reviewed. It is deliberately NOT read from the request, the environment or the SPA, so a
// caller cannot bypass it with a parameter. Keep false until the approval path is certified against the staging
// contract. Mirrors attendance-submit-hold.ts.
export const AVAILABILITY_APPROVAL_CERTIFIED = false;

export const APPROVAL_HELD_CODE = "APPROVAL_HELD";
export const APPROVAL_HELD_STATUS = 423;
export const APPROVAL_HELD_MESSAGE =
  "Availability approval is on hold pending certification. Nothing has been changed.";

export function assertAvailabilityApprovalCertified(certified: boolean = AVAILABILITY_APPROVAL_CERTIFIED): void {
  if (!certified) {
    throw new ApiError("APPROVAL_HELD", APPROVAL_HELD_MESSAGE, APPROVAL_HELD_STATUS);
  }
}
