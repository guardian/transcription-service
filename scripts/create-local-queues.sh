#!/usr/bin/env bash
# If the queues already exists the commands should still work, just returning the existing queue url
APP_NAME="transcription-service"
#########
##### task dead letter queue
#########
DEAD_LETTER_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-task-dead-letter-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true" | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
DEAD_LETTER_QUEUE_URL_LOCALHOST=${DEAD_LETTER_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${DEAD_LETTER_QUEUE_URL_LOCALHOST}"

#########
##### task queue
#########
TASK_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-task-queue-DEV.fifo \
  --attributes '{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:transcription-service-task-dead-letter-queue-DEV.fifo\",\"maxReceiveCount\":\"3\"}"
  }' | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
TASK_QUEUE_URL_LOCALHOST=${TASK_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created cpu task queue in localstack, url: ${TASK_QUEUE_URL_LOCALHOST}"

GPU_TASK_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-gpu-task-queue-DEV.fifo \
  --attributes '{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:transcription-service-task-dead-letter-queue-DEV.fifo\",\"maxReceiveCount\":\"3\"}"
  }' | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
GPU_TASK_QUEUE_URL_LOCALHOST=${GPU_TASK_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created gpu task queue in localstack, url: ${GPU_TASK_QUEUE_URL_LOCALHOST}"

#########
##### output queue
#########
OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-output-queue-DEV | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
OUTPUT_QUEUE_URL_LOCALHOST=${OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created output queue in localstack, url: ${OUTPUT_QUEUE_URL_LOCALHOST}"

MEDIA_DOWNLOAD_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-media-download-queue-DEV | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
MEDIA_DOWNLOAD_QUEUE_URL_LOCALHOST=${MEDIA_DOWNLOAD_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created media download queue in localstack, url: ${MEDIA_DOWNLOAD_QUEUE_URL_LOCALHOST}"

WEBPAGE_SNAPSHOT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-webpage-snapshot-queue-DEV  | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
WEBPAGE_SNAPSHOT_QUEUE_URL_LOCALHOST=${WEBPAGE_SNAPSHOT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created webpage snapshot queue in localstack, url: ${WEBPAGE_SNAPSHOT_QUEUE_URL_LOCALHOST}"

# Combined SNS topic to send to webpage snapshot and media download
REMOTE_INGEST_TOPIC=$(aws sns create-topic --endpoint-url=http://localhost:4566 --name transcription-service-combined-task-topic-DEV | jq -r .TopicArn)

# subscribe media download and webpage snapshot queues to the topic
echo $WEBPAGE_SNAPSHOT_QUEUE_ARN
aws sns subscribe --endpoint-url=http://localhost:4566 --attributes RawMessageDelivery=true --topic-arn $REMOTE_INGEST_TOPIC --protocol sqs --notification-endpoint "arn:aws:sqs:eu-west-1:000000000000:transcription-service-webpage-snapshot-queue-DEV"
aws sns subscribe --endpoint-url=http://localhost:4566 --attributes RawMessageDelivery=true --topic-arn $REMOTE_INGEST_TOPIC --protocol sqs --notification-endpoint "arn:aws:sqs:eu-west-1:000000000000:transcription-service-media-download-queue-DEV"

echo "Created SNS topic in localstack, arn: ${REMOTE_INGEST_TOPIC}"


# ###########
# Creating output queue for Giant:
# Giant is a service that uses transcription service to transcribe its audio/video files.
# Giant pushes messages to the transcription input queue 'transcription-service-task-queue-DEV.fifo'
# and transcription worker pushes the resulting transcripts into the giant output queue 'giant-output-queue-DEV.fifo'.
# Since creating multiple localstack containers could add complication, and localstack is
# only needed for local running, the giant output queue is created in the transcription service localstack.
# ###########

#########
##### giant output dead letter queue
#########
GIANT_OUTPUT_DEAD_LETTER_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-output-dead-letter-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true" | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST=${GIANT_OUTPUT_DEAD_LETTER_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST}"

#########
##### giant output queue
#########
GIANT_OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-output-queue-DEV.fifo \
  --attributes '{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:giant-output-dead-letter-queue-DEV.fifo\",\"maxReceiveCount\":\"3\"}"
  }' | jq .QueueUrl)


# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_OUTPUT_QUEUE_URL_LOCALHOST=${GIANT_OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_OUTPUT_QUEUE_URL_LOCALHOST}"


#########
##### giant media download output dead letter queue
#########
GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-media-download-output-dead-letter-queue-DEV  | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST=${GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST}"

#########
##### giant media download output queue
#########
GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-media-download-output-queue-DEV \
  --attributes '{
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:giant-media-download-output-dead-letter-queue-DEV\",\"maxReceiveCount\":\"3\"}"
  }' | jq .QueueUrl)


# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL_LOCALHOST=${GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL_LOCALHOST}"
