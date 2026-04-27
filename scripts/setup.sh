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

$SCRIPT_PATH/create-localstack-resources.sh

echo ""
echo "Installing whisperX dependencies (required to run gpu worker locally)"
echo ""

pipenv install

echo ""
echo "Installing llama.cpp"

brew install llama.cpp

echo ""
echo "Saving model to use for llama.cpp to /etc/gu/models."

export AWS_PROFILE=investigations
HUGGINGFACE_TOKEN=$(aws ssm get-parameter --name /DEV/investigations/transcription-service/dev/huggingfaceToken --query Parameter.Value --output text --region eu-west-1)

mkdir -p /etc/gu/models
curl -L --fail -o /etc/gu/models/dev-llama-cpp-model.gguf \
            -H "Authorization: Bearer ${HUGGINGFACE_TOKEN}" \
            "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"
