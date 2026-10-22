#!/bin/bash
PROJECT_REF="xelpsttqhrcqmttmjory"
FUNCTIONS="registration-processor moodle-sync email-sender retry-worker notification-batch-processor notification-dispatcher phase2-processor"

for fn in $FUNCTIONS; do
  echo "Deploying $fn..."
  supabase functions deploy $fn
done

echo "All functions deployed."

