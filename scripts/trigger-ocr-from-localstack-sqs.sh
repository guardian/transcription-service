#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" || ! -r "$1" ]]; then
  echo "Usage: $0 <input.pdf>" >&2
  exit 1
fi

REGION="${AWS_REGION:-eu-west-1}"
FILENAME=$(basename -- "$1")
BUCKET=$(aws --region "$REGION" ssm get-parameter \
  --name /DEV/investigations/transcription-service/app/sourceMediaBucket \
  --query Parameter.Value --output text)
aws --region "$REGION" s3 cp "$1" "s3://$BUCKET/$FILENAME"
INPUT_URL=$(aws --region "$REGION" s3 presign "s3://$BUCKET/$FILENAME" --expires-in 43200)
OUTPUT_KEY="${FILENAME%.*}.output.pdf"
# aws s3 presign only supports GET; boto3 signs the worker's PUT request.
OUTPUT_URL=$(python3 - "$REGION" "$BUCKET" "$OUTPUT_KEY" <<'PY'
import sys
import boto3
from botocore.config import Config

region, bucket, key = sys.argv[1:]
s3 = boto3.client('s3', region_name=region, config=Config(signature_version='s3v4'))
print(s3.generate_presigned_url(
    'put_object',
    Params={'Bucket': bucket, 'Key': key},
    ExpiresIn=43200,
    HttpMethod='PUT',
))
PY
)

JOB_ID=$(node -p 'require("node:crypto").randomUUID()')
QUEUE_URL="http://localhost:4566/000000000000/transcription-service-gpu-task-queue-DEV.fifo"
MESSAGE_BODY='{
    "id": "abc123",
    "originalFilename": "toast_sandwich_en_wiki.pdf",
    "inputSignedUrl": "",
    "sentTimestamp": "timestamp",
    "userEmail": "email@email.com",
    "transcriptDestinationService": "TranscriptionService",
    "combinedOutputUrl": {"url": "abc", "key": "abc"},
    "jobType": "ocr",
    "settings": {"ocrLanguage": "eng"}
  }'

MESSAGE_BODY=$(jq \
  --arg id "$JOB_ID" \
  --arg filename "$FILENAME" \
  --arg inputUrl "$INPUT_URL" \
  --arg outputUrl "$OUTPUT_URL" \
  --arg outputKey "$OUTPUT_KEY" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '.id = $id | .originalFilename = $filename | .inputSignedUrl = $inputUrl | .combinedOutputUrl = {url: $outputUrl, key: $outputKey} | .sentTimestamp = $timestamp' <<< "$MESSAGE_BODY")

AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_SESSION_TOKEN='' \
aws --endpoint-url "http://localhost:4566" --region "${AWS_REGION:-eu-west-1}" sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body "$MESSAGE_BODY" \
  --message-group-id "$JOB_ID" \
  --message-deduplication-id "$JOB_ID"

echo "Enqueued OCR job $JOB_ID on $QUEUE_URL"
