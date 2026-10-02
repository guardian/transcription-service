#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/create-localstack-resources.sh [port]
LOCALSTACK_PORT=${1:-${LOCALSTACK_PORT:-4566}}
if [[ $# -gt 1 || ! "$LOCALSTACK_PORT" =~ ^[0-9]+$ ]] || (( LOCALSTACK_PORT < 1 || LOCALSTACK_PORT > 65535 )); then
  echo "Usage: $0 [port (1-65535, default 4566)]" >&2
  exit 1
fi

APP_NAME="transcription-service"
ENDPOINT="http://localhost:${LOCALSTACK_PORT}"
export AWS_REGION="eu-west-1"
# Provision only local resources; no Janus credentials are needed for this script.
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
unset AWS_PROFILE AWS_SESSION_TOKEN
export AWS_PAGER=""

local_aws() {
  aws --endpoint-url="$ENDPOINT" --region "$AWS_REGION" "$@"
}

create_queue() {
  local name=$1
  local dead_letter_name=${2:-}
  local attributes='{}'
  if [[ "$name" == *.fifo ]]; then
    attributes='{"FifoQueue":"true","ContentBasedDeduplication":"true"}'
  fi
  if [[ -n "$dead_letter_name" ]]; then
    attributes=$(jq -cn --argjson attributes "$attributes" \
      --arg arn "arn:aws:sqs:${AWS_REGION}:000000000000:${dead_letter_name}" \
      '$attributes + {RedrivePolicy: ({deadLetterTargetArn: $arn, maxReceiveCount: "3"} | tojson)}')
  fi
  local_aws sqs create-queue --queue-name "$name" --attributes "$attributes"
}

TASK_DLQ="$APP_NAME-task-dead-letter-queue-DEV.fifo"
create_queue "$TASK_DLQ"
create_queue "$APP_NAME-task-queue-DEV.fifo" "$TASK_DLQ"
create_queue "$APP_NAME-gpu-task-queue-DEV.fifo" "$TASK_DLQ"
create_queue "$APP_NAME-output-queue-DEV"
create_queue "$APP_NAME-media-download-queue-DEV"
create_queue "$APP_NAME-webpage-snapshot-queue-DEV"

REMOTE_INGEST_TOPIC=$(local_aws sns create-topic \
  --name "$APP_NAME-combined-task-topic-DEV" --query TopicArn --output text)
for queue in "$APP_NAME-webpage-snapshot-queue-DEV" "$APP_NAME-media-download-queue-DEV"; do
  local_aws sns subscribe --attributes RawMessageDelivery=true \
    --topic-arn "$REMOTE_INGEST_TOPIC" --protocol sqs \
    --notification-endpoint "arn:aws:sqs:${AWS_REGION}:000000000000:${queue}"
done

# Giant's reply queues live in whichever LocalStack instance was selected.
create_queue giant-output-dead-letter-queue-DEV.fifo
create_queue giant-output-queue-DEV.fifo giant-output-dead-letter-queue-DEV.fifo
create_queue giant-media-download-output-dead-letter-queue-DEV
create_queue giant-media-download-output-queue-DEV giant-media-download-output-dead-letter-queue-DEV

# Repeated startup must preserve existing tables and their contents.
TABLES=$(local_aws dynamodb list-tables --output json)
for table in "$APP_NAME-DEV" "$APP_NAME-events-DEV"; do
  if ! jq -e --arg table "$table" '.TableNames | index($table) != null' <<< "$TABLES" >/dev/null; then
    local_aws dynamodb create-table --table-name "$table" \
      --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
      --attribute-definitions AttributeName=id,AttributeType=S \
      --key-schema AttributeName=id,KeyType=HASH
  fi
  local_aws dynamodb wait table-exists --table-name "$table"
done

echo "LocalStack resources ready at $ENDPOINT"
