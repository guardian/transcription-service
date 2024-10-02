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
APP_NAME="transcription-service"
# If the queue already exists this command appears to still work and returns the existing queue url
QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-task-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true" | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
QUEUE_URL_LOCALHOST=${QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${QUEUE_URL_LOCALHOST}"

OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-output-queue-DEV | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
OUTPUT_QUEUE_URL_LOCALHOST=${OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${OUTPUT_QUEUE_URL_LOCALHOST}"

# ###########
# Create output queue for Giant:
# Giant is a service that uses transcription service to transcribe its audio/video files.
# Giant pushes messages to the transcription input queue 'transcription-service-task-queue-DEV.fifo'
# and transcription worker pushes the giant transcripts into the giant output queue 'giant-output-queue-DEV'.
# Since creating multiple localstack containers could add complication, and localstack is
# only needed for local running, the giant output queue is created in the localstack created for transcription service.
# ###########
OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-output-queue-DEV | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
OUTPUT_QUEUE_URL_LOCALHOST=${OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${OUTPUT_QUEUE_URL_LOCALHOST}"

DYNAMODB_ARN=$(aws --endpoint-url=http://localhost:4566 dynamodb create-table \
                                         --table-name ${APP_NAME}-DEV \
                                         --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
                                         --attribute-definitions AttributeName=id,AttributeType=S \
                                         --key-schema AttributeName=id,KeyType=HASH | jq .TableDescription.TableArn)

echo "Created table, arn: ${DYNAMODB_ARN}"





