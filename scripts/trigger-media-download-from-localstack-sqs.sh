#!/usr/bin/env bash

set -e

# Read the top message in "http://localhost:4566/000000000000/transcription-service-media-download-queue-DEV.fifo" and store
# in variable MESSAGE_BODY, delete that item from the queue

QUEUE_URL="http://localhost:4566/000000000000/transcription-service-media-download-queue-DEV.fifo"

export MESSAGE_BODY=$(aws sqs receive-message --queue-url $QUEUE_URL --max-number-of-messages 1 --wait-time-seconds 10 --endpoint-url http://localhost:4566 | jq -r '.Messages[0].Body')
echo $MESSAGE_BODY

if [ -z "$MESSAGE_BODY" ]; then
  echo "No messages in the queue."
  exit 0
fi

npm run media-download::start

# delete message
aws sqs delete-message --queue-url $QUEUE_URL --receipt-handle $(echo $MESSAGE_BODY | jq -r '.ReceiptHandle') --endpoint-url http://localhost:4566
