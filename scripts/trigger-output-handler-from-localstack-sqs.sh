#!/usr/bin/env bash

set -e

QUEUE_URL="http://localhost:4566/000000000000/transcription-service-output-queue-DEV"

export MESSAGE_BODY=$(aws sqs receive-message --queue-url $QUEUE_URL --max-number-of-messages 1 --wait-time-seconds 10 --endpoint-url http://localhost:4566 | jq -r '.Messages[0].Body')
echo $MESSAGE_BODY

if [ -z "$MESSAGE_BODY" ]; then
  echo "No messages in the queue."
  exit 0
fi

npm run output-handler::start
