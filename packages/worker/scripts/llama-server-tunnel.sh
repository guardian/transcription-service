#!/usr/bin/env bash
set -e

# Opens an SSH tunnel to the llama-server running on a
# transcription gpu-worker instance, exposing it on a local port.
# Note - you will need to manually start llama-server on the remote instance
#
# Usage:
#   ./llama-server-tunnel.sh
#
# Then hit the OpenAI-compatible endpoint at http://localhost:19080, e.g.
#   curl http://localhost:9080/v1/chat/completions ...
# or run the benchmark script (packages/worker/scripts/benchmark-translation.ts).

STAGE=${1:-code}

AWS_PROFILE=investigations
# App tag of the GPU worker instances that run llama-server (see cdk/lib/transcription-service.ts).
TARGET_APP=transcription-service-gpu-worker
# Port llama-server listens on remotely (see packages/worker/src/llama-server.ts).
REMOTE_LLAMA_PORT=9080
# Local port to expose the completions endpoint on.
LOCAL_PORT=${LOCAL_PORT:-19080}
# How long ssh stays alive waiting for / holding a connection. The tunnel remains open while at
# least one connection is active, so this mainly bounds an idle tunnel. Bump it for long benchmarks.
TUNNEL_LIFETIME_SECONDS=${TUNNEL_LIFETIME_SECONDS:-3600}

echo "Finding the newest ${TARGET_APP} instance and building an SSH command..."
SSH_COMMAND=$(ssm ssh --raw -t "${TARGET_APP}",${STAGE} --newest --profile "${AWS_PROFILE}")

# -f runs ssh in the background; `sleep` keeps the session alive long enough to establish and hold
# the tunnel. Once a client connects, ssh keeps the tunnel open until the connection closes.
# -o ExitOnForwardFailure=yes makes ssh fail fast if the local port is already in use.
eval ${SSH_COMMAND} \
  -L ${LOCAL_PORT}:localhost:${REMOTE_LLAMA_PORT} \
  -o ExitOnForwardFailure=yes \
  -f sleep ${TUNNEL_LIFETIME_SECONDS}

# The remote session tends to leave the local terminal in a bad state; reset it (as psql-code.sh does).
reset

echo "Tunnel established: http://localhost:${LOCAL_PORT} -> ${TARGET_APP} llama-server:${REMOTE_LLAMA_PORT}"
echo "It will stay open while a connection is active, and otherwise close after ${TUNNEL_LIFETIME_SECONDS}s."
