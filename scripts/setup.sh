#/usr/bin/env bash
set -e

SCRIPT_PATH=$( cd $(dirname $0) ; pwd -P )


npm install

case "$(uname -s)" in
  Darwin)
    brew install llama.cpp pyenv pipenv ffmpeg
    dev-nginx setup-app nginx/nginx-mapping.yml
    ;;
  Linux)
    echo "Running in linux (probably a dev container) NOTE: If this is the first time you have run Lurch you'll need to run dev-nginx outside the container by running the below command on your host machine:"
    echo "dev-nginx setup-app nginx/nginx-mapping.yml"
    echo "Detected Linux, installing packages with apt..."
    sudo apt-get update
    sudo apt-get install -y \
      awscli \
      llama.cpp \
      pipenv \
      pyenv \
      ffmpeg
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    exit 1
    ;;
esac

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
echo "Saving model to use for llama.cpp to /etc/gu/models."

export AWS_PROFILE=investigations
HUGGINGFACE_TOKEN=$(aws ssm get-parameter --name /DEV/investigations/transcription-service/dev/huggingfaceToken --query Parameter.Value --output text --region eu-west-1)

echo "Creating /etc/gu/models directory to save model in - you may need to enter your password if /etc/gu doesn't exist"
sudo mkdir -p /etc/gu/models && sudo chown -R $(whoami) /etc/gu
MODEL_PATH="/etc/gu/models/dev-llama-cpp-model.gguf"
curl -L --fail -o ${MODEL_PATH} \
            -H "Authorization: Bearer ${HUGGINGFACE_TOKEN}" \
            "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"
echo "Model saved to ${MODEL_PATH}. Note that the app reads the DEV model path from https://eu-west-1.console.aws.amazon.com/systems-manager/parameters/%252FDEV%252Finvestigations%252Ftranscription-service%252Fllamacpp%252FmodelPath/description?region=eu-west-1"