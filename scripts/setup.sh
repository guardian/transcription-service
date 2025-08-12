#/usr/bin/env bash
set -e

SCRIPT_PATH=$( cd $(dirname $0) ; pwd -P )


#npm install

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

./create-local-queues.sh

#########
##### giant media download output dead letter queue
#########
GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-media-download-output-dead-letter-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true" | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST=${GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_MEDIA_DOWNLOAD_OUTPUT_DEAD_LETTER_QUEUE_URL_LOCALHOST}"

#########
##### giant media download output queue
#########
GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=giant-media-download-output-queue-DEV.fifo \
  --attributes '{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:giant-media-download-output-dead-letter-queue-DEV.fifo\",\"maxReceiveCount\":\"3\"}"
  }' | jq .QueueUrl)


# We don't install the localstack dns so need to replace the endpoint with localhost
GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL_LOCALHOST=${GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${GIANT_MEDIA_DOWNLOAD_OUTPUT_QUEUE_URL_LOCALHOST}"

DYNAMODB_ARN=$(aws --endpoint-url=http://localhost:4566 dynamodb create-table \
                                         --table-name ${APP_NAME}-DEV \
                                         --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
                                         --attribute-definitions AttributeName=id,AttributeType=S \
                                         --key-schema AttributeName=id,KeyType=HASH | jq .TableDescription.TableArn)

echo "Created table, arn: ${DYNAMODB_ARN}"

echo ""
echo "Installing whisperX dependencies (required to run gpu worker locally)"
echo ""

pipenv install
