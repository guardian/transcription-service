#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH=$(cd "$(dirname "$0")" && pwd -P)
cd "$SCRIPT_PATH/.."

WORKER_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --worker-only) WORKER_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--worker-only]"
      echo "--worker-only installs worker dependencies and models, skipping dev-nginx and Docker."
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

npm install

case "$(uname -s)" in
  Darwin)
    brew install llama.cpp pyenv uv ffmpeg
    if [[ "$WORKER_ONLY" == false ]]; then
      dev-nginx setup-app nginx/nginx-mapping.yml
    fi
    ;;
  Linux)
    if [[ "$WORKER_ONLY" == false ]]; then
      echo "Running in linux (probably a dev container) NOTE: If this is the first time you have run the app locally you'll"
      echo "need to run dev-nginx outside the container by running the below command on your host machine:"
      echo "dev-nginx setup-app nginx/nginx-mapping.yml"
    fi
    echo "Detected Linux, installing packages with apt..."
    sudo apt-get update
    sudo apt-get install -y \
      awscli \
      llama.cpp \
      pyenv \
      ffmpeg
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    exit 1
    ;;
esac

if [[ "$WORKER_ONLY" == false ]]; then
  if (! docker stats --no-stream 1>/dev/null 2>&1); then
    echo "Starting docker..."
    # On Mac OS this would be the terminal command to launch Docker
    open /Applications/Docker.app
    # Wait until Docker daemon is running and has completed initialisation
    while (! docker stats --no-stream 1>/dev/null 2>&1); do
      echo "Docker not initialised yet, waiting 1 second..."
      sleep 1
    done
    echo "Docker started!"
  fi

  docker compose up -d
  "$SCRIPT_PATH/create-localstack-resources.sh"
fi

echo ""
echo "Installing whisperX dependencies (required to run gpu worker locally)"
echo ""

uv sync

echo ""
echo "Saving model to use for llama.cpp to /etc/gu/models."

export AWS_PROFILE=investigations
if ! HUGGINGFACE_TOKEN=$(aws ssm get-parameter --name /DEV/investigations/transcription-service/dev/huggingfaceToken --query Parameter.Value --output text --region eu-west-1); then
  echo "Could not fetch the Hugging Face token from AWS Parameter Store. The investigations profile may be missing or its credentials may have expired." >&2
  echo "Fetch read-only investigations credentials from https://janus.gutools.co.uk/credentials?permissionId=investigations-read-only&tzOffset=1, and rerun setup." >&2
  exit 1
fi

echo "Creating /etc/gu/models directory to save model in - you may need to enter your password if /etc/gu doesn't exist"
sudo mkdir -p /etc/gu/models && sudo chown -R $(whoami) /etc/gu
MODEL_PATH="/etc/gu/models/dev-llama-cpp-model.gguf"
curl -L --fail -o ${MODEL_PATH} \
            -H "Authorization: Bearer ${HUGGINGFACE_TOKEN}" \
            "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"
echo "Model saved to ${MODEL_PATH}. Note that the app reads the DEV model path from https://eu-west-1.console.aws.amazon.com/systems-manager/parameters/%252FDEV%252Finvestigations%252Ftranscription-service%252Fllamacpp%252FmodelPath/description?region=eu-west-1"
