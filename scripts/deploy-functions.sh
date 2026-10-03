#!/bin/bash
# Deploy the Edge Functions that make up the C6 Rock Solid -> Nexus integration, plus the retired-writer
# tombstones. This is a SUBSET deploy; `supabase functions deploy` (no name) deploys everything.
#
# The intended deployed state is explicit here and enforced by supabase/functions/deploy-inventory.test.ts:
#
#   ACTIVE
#     missed-class-detector  the ONLY C6 producer (scheduled; creates Nexus tasks via _shared/nexus-tasks.ts)
#     retry-worker           reconciles TIMEOUT_UNKNOWN Nexus outcomes (scheduled; also Moodle retries)
#     (+ the other existing functions below)
#   RETIRED (must be deployed so they REPLACE any live copy)
#     clickup-sync           old Nexus/ClickUp task writer, now a 410 tombstone. If it is not redeployed the OLD
#                            LIVE WRITER (non-atomic select/upsert, retry loop, can duplicate tasks) keeps running.
#     notification-dispatcher old unauthenticated writer, now a 410 tombstone.
#
# verify_jwt is NOT passed on the command line: it comes from supabase/config.toml ([functions.<name>]), where
# both tombstones are verify_jwt = false so callers get the 410 instead of a platform 401.
set -euo pipefail

PROJECT_REF="xelpsttqhrcqmttmjory"

ACTIVE_FUNCTIONS="registration-processor moodle-sync email-sender retry-worker notification-batch-processor missed-class-detector phase2-processor"
RETIRED_TOMBSTONES="clickup-sync notification-dispatcher"

echo "Project: $PROJECT_REF"
echo "Active:  $ACTIVE_FUNCTIONS"
echo "Retired: $RETIRED_TOMBSTONES"

for fn in $ACTIVE_FUNCTIONS $RETIRED_TOMBSTONES; do
  echo "Deploying $fn..."
  supabase functions deploy "$fn"
done

echo "All functions deployed."
echo "Verify the tombstones answer 410 (POST, no credentials):"
for fn in $RETIRED_TOMBSTONES; do
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST https://$PROJECT_REF.supabase.co/functions/v1/$fn   # expect 410"
done
