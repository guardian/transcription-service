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
# If the queue already exists this command appears to still work and returns the existing queue url
QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=transcription-service-task-queue-DEV | jq .QueueUrl)
# We don't install the localstack dns so need to replace the endpoint with localhost
QUEUE_URL_LOCALHOST=${QUEUE_URL/sqs.eu-west-1.localhost.localstack.cloud/localhost}

echo "Created queue in localstack, url: ${QUEUE_URL_LOCALHOST}"