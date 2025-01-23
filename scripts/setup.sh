#/usr/bin/env bash
set -e

SCRIPT_PATH=$( cd $(dirname $0) ; pwd -P )


npm install

dev-nginx setup-app nginx/nginx-mapping.yml

if (! docker stats --no-stream 1>/dev/null 2>&1); then
  echo "Starting docker..."
  # On Mac OS this would be the terminal command to launch Docker
  open /Applications/Docker.app
  # Wait until Docker daemon is running and has completed initialisation
  while (! docker stats --no-stream 1>/dev/null 2>&1); do
    # Docker takes a few seconds to initialize
    echo "Docker not initialised yet, waiting 1 second..."
    sleep 1
  done
  echo "Docker started!"
fi

# Starting localstack
docker-compose up -d
export AWS_REGION=eu-west-1
APP_NAME="transcription-service"
# If the queue already exists this command appears to still work and returns the existing queue url

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

DYNAMODB_ARN=$(aws --endpoint-url=http://localhost:4566 dynamodb create-table \
                                         --table-name ${APP_NAME}-DEV \
                                         --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
                                         --attribute-definitions AttributeName=id,AttributeType=S \
                                         --key-schema AttributeName=id,KeyType=HASH | jq .TableDescription.TableArn)

echo "Created table, arn: ${DYNAMODB_ARN}"
