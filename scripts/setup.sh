#/usr/bin/env bash
set -e

SCRIPT_PATH=$( cd $(dirname $0) ; pwd -P )
APP_NAME="transcription-service"

# npm install

# dev-nginx setup-app nginx/nginx-mapping.yml

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

# Wait for localstack to be ready
DEAD_LETTER_OUTPUT=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-task-dead-letter-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true")
echo $DEAD_LETTER_OUTPUT
DEAD_LETTER_QUEUE_URL=$(echo $DEAD_LETTER_OUTPUT | jq .QueueUrl)
DEAD_LETTER_QUEUE_URL_LOCALHOST=${QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}
echo "Created queue in localstack, url: ${DEAD_LETTER_QUEUE_URL_LOCALHOST}"

# If the queue already exists this command appears to still work and returns the existing queue url
QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=$APP_NAME-task-queue-DEV.fifo --attributes "FifoQueue=true,ContentBasedDeduplication=true" | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
QUEUE_URL_LOCALHOST=${QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${QUEUE_URL_LOCALHOST}"

TOPIC_ARN=$(aws --endpoint-url=http://localhost:4566 sns create-topic --name $APP_NAME-destination-topic-DEV | jq .TopicArn)

echo "Created topic in localstack, arn: ${TOPIC_ARN}"

DYNAMODB_ARN=$(aws --endpoint-url=http://localhost:4566 dynamodb create-table \
                                         --table-name ${APP_NAME}-DEV \
                                         --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
                                         --attribute-definitions AttributeName=id,AttributeType=S \
                                         --key-schema AttributeName=id,KeyType=HASH | jq .TableDescription.TableArn)

echo "Created table, arn: ${DYNAMODB_ARN}"





