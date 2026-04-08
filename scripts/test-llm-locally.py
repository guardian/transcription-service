#!/usr/bin/env python3
"""
Test script for local LLM (llama-server) functionality.

Prerequisites:
  - llama.cpp installed via brew (brew install llama.cpp)
  - localstack running (docker-compose up -d)
  - localstack resources created (./scripts/create-localstack-resources.sh)
  - AWS profile 'investigations' configured

Usage:
  python scripts/test-llm-locally.py [prompt]

If no prompt is provided, a default example prompt is used.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
import requests
from botocore.config import Config

# ── Configuration ────────────────────────────────────────────────────────────

AWS_REGION = "eu-west-1"
AWS_PROFILE = "investigations"

LOCALSTACK_ENDPOINT = "http://localhost:4566"
LLAMA_SERVER_PORT = 9080
LLAMA_SERVER_URL = f"http://localhost:{LLAMA_SERVER_PORT}"
SOURCE_BUCKET = "transcription-service-source-media-dev"
OUTPUT_BUCKET = "transcription-service-output-dev"
TASK_QUEUE_URL = f"{LOCALSTACK_ENDPOINT}/000000000000/transcription-service-gpu-task-queue-DEV.fifo"
OUTPUT_QUEUE_URL = f"{LOCALSTACK_ENDPOINT}/000000000000/transcription-service-output-queue-DEV"
MODEL_REPOSITORY = "Qwen/Qwen3-0.6B-GGUF"
MODEL = "Qwen3-0.6B-Q8_0.gguf"

JOB_ID = f"llm-test-{int(time.time())}"
PROMPT_KEY = f"llm-prompts/{JOB_ID}.txt"
OUTPUT_KEY = f"llm-output/{JOB_ID}.txt"

DEFAULT_PROMPT = (
    "Now pull your socks out and get your shoes on. Come on, all of you. Oh, man. And listen, while we're at it, there are systems for a reason in this world. Economic stability, interest rates, growth. It's not all a conspiracy to keep you in little boxes, all right? It's only the miracle of consumer capitalism that means you're not lying in your own shit, dying at 43 with rotten teeth, and a little pill with a chicken on it is not going to change that."
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def banner(title: str) -> None:
    print("============================================")
    print(f"  {title}")
    print("============================================")


def check_health(url: str) -> bool:
    try:
        r = requests.get(f"{url}/health", timeout=2)
        return r.ok
    except requests.ConnectionError:
        return False


def make_session() -> boto3.Session:
    return boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)


def s3_client(session: boto3.Session, endpoint_url: str | None = None):
    return session.client(
        "s3",
        config=Config(signature_version="s3v4"),
        endpoint_url=endpoint_url,
    )


def sqs_client(session: boto3.Session):
    return session.client("sqs", endpoint_url=LOCALSTACK_ENDPOINT)


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    prompt = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROMPT

    # Set env vars so child processes (e.g. npm) inherit them
    os.environ["AWS_REGION"] = AWS_REGION
    os.environ["AWS_PROFILE"] = AWS_PROFILE

    banner("LLM Local Test Script")
    print()

    session = make_session()
    llama_pid: subprocess.Popen | None = None

    # ── Step 1: Check llama-server is available ──────────────────────────
    print(">> Checking llama-server is installed...")
    if not shutil.which("llama-server"):
        print("ERROR: llama-server not found. Install it with: brew install llama.cpp")
        sys.exit(1)
    print("   ✓ llama-server found")

    # ── Step 2: Start llama-server if not already running ────────────────
    print()
    print(f">> Checking if llama-server is already running on port {LLAMA_SERVER_PORT}...")

    if check_health(LLAMA_SERVER_URL):
        print("   ✓ llama-server is already running")
    else:
        print("   llama-server is not running - starting it...")

        llama_model_env = os.environ.get("LLAMA_MODEL")
        if llama_model_env:
            model_path = Path(llama_model_env)
        else:
            possible_paths = [
                Path.home() / ".cache" / "llama.cpp" / MODEL,
            ]
            model_path = next((p for p in possible_paths if p.is_file()), None)

            if model_path is None:
                hf_token = os.environ.get("HF_TOKEN")
                if not hf_token:
                    print()
                    print("ERROR: No model file found and HF_TOKEN is not set.")
                    print(
                        "Either set LLAMA_MODEL to point to an existing .gguf file, or set HF_TOKEN"
                    )
                    print(
                        "to allow the script to download a small test model from Hugging Face."
                    )
                    print()
                    print("  export HF_TOKEN=hf_your_token_here")
                    print("  python scripts/test-llm-locally.py")
                    sys.exit(1)

                print()
                print(
                    f"   No model file found. Downloading a small test model {MODEL_REPOSITORY}..."
                )
                cache_dir = Path.home() / ".cache" / "llama.cpp"
                cache_dir.mkdir(parents=True, exist_ok=True)
                model_path = cache_dir / MODEL

                download_url = f"https://huggingface.co/{MODEL_REPOSITORY}/resolve/main/{MODEL}"
                r = requests.get(
                    download_url,
                    headers={"Authorization": f"Bearer {hf_token}"},
                    stream=True,
                    timeout=300,
                )
                r.raise_for_status()
                with open(model_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"   ✓ Model downloaded to {model_path}")

        print(f"   Starting llama-server with model: {model_path}")
        log_file = open("/tmp/llama-server-test.log", "w")
        llama_pid = subprocess.Popen(
            ["llama-server", "-m", str(model_path), "--port", str(LLAMA_SERVER_PORT)],
            stdout=log_file,
            stderr=log_file,
        )
        print(f"   llama-server PID: {llama_pid.pid}")

        def cleanup_llama():
            if llama_pid and llama_pid.poll() is None:
                print()
                print(f">> Stopping llama-server (PID: {llama_pid.pid})...")
                llama_pid.terminate()
                try:
                    llama_pid.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    llama_pid.kill()
                print("   ✓ Stopped")

        atexit.register(cleanup_llama)

        # Wait for llama-server to be ready
        print("   Waiting for llama-server to be ready...")
        max_wait = 60
        waited = 0
        while not check_health(LLAMA_SERVER_URL):
            time.sleep(2)
            waited += 2
            if waited >= max_wait:
                print(f"ERROR: llama-server did not start within {max_wait} seconds")
                print("Check logs at /tmp/llama-server-test.log")
                llama_pid.kill()
                sys.exit(1)
        print(f"   ✓ llama-server is ready (took ~{waited}s)")

    # ── Step 3: Upload prompt to S3 source bucket ────────────────────────
    print()
    print(">> Uploading prompt to S3...")
    s3 = s3_client(session)
    s3.put_object(Bucket=SOURCE_BUCKET, Key=PROMPT_KEY, Body=prompt.encode("utf-8"))
    print(f"   ✓ Prompt uploaded to s3://{SOURCE_BUCKET}/{PROMPT_KEY}")

    # ── Step 4: Generate presigned URLs for input and output ─────────────
    print()
    print(">> Generating presigned URLs...")

    input_presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": SOURCE_BUCKET, "Key": PROMPT_KEY},
        ExpiresIn=3600,
    )
    print("   ✓ Input presigned URL (GET) generated")

    output_presigned_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": OUTPUT_BUCKET, "Key": OUTPUT_KEY},
        ExpiresIn=3600,
    )
    print("   ✓ Output presigned URL (PUT) generated")

    # ── Step 5: Send LLM job to the task queue ───────────────────────────
    print()
    print(">> Sending LLM job to task queue...")

    sqs = sqs_client(session)
    message_body = json.dumps(
        {
            "id": JOB_ID,
            "jobType": "llm",
            "originalFilename": "test-prompt.txt",
            "inputSignedUrl": input_presigned_url,
            "sentTimestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "userEmail": "test@guardian.co.uk",
            "transcriptDestinationService": "TranscriptionService",
            "combinedOutputUrl": {
                "url": output_presigned_url,
                "key": OUTPUT_KEY,
            },
        }
    )

    send_resp = sqs.send_message(
        QueueUrl=TASK_QUEUE_URL,
        MessageBody=message_body,
        MessageGroupId="llm-test",
    )
    print(json.dumps(send_resp, indent=2, default=str))
    print(f"   ✓ LLM job sent to task queue (job id: {JOB_ID})")

    # ── Step 7: Poll the output queue for the result ─────────────────────
    print()
    print(">> Polling output queue for result...")

    max_poll_wait = 300
    poll_waited = 0
    poll_interval = 5
    result = None

    while poll_waited < max_poll_wait:
        try:
            response = sqs.receive_message(
                QueueUrl=OUTPUT_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=poll_interval,
            )
        except Exception:
            response = {}

        messages = response.get("Messages", [])
        if messages:
            body_str = messages[0].get("Body", "")
            if body_str:
                try:
                    body = json.loads(body_str)
                except json.JSONDecodeError:
                    body = {}

                if body.get("id") == JOB_ID:
                    result = body
                    receipt_handle = messages[0].get("ReceiptHandle", "")
                    try:
                        sqs.delete_message(
                            QueueUrl=OUTPUT_QUEUE_URL,
                            ReceiptHandle=receipt_handle,
                        )
                    except Exception:
                        pass
                    break

        poll_waited += poll_interval
        print(f"   Waiting for result... ({poll_waited}s / {max_poll_wait}s)")

    # Stop the worker
    worker_proc.terminate()
    try:
        worker_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        worker_proc.kill()

    print()
    banner("Result")

    if result:
        status = result.get("status", "")
        print()
        print(f"Status: {status}")
        print()
        print("Output message:")
        print(json.dumps(result, indent=2))

        if status == "LLM_SUCCESS":
            print()
            print(">> Downloading LLM output from S3...")
            try:
                obj = s3.get_object(Bucket=OUTPUT_BUCKET, Key=OUTPUT_KEY)
                output_content = obj["Body"].read().decode("utf-8")
            except Exception:
                output_content = "[Could not download output]"
            print()
            banner("LLM Response")
            print()
            print(output_content)
    else:
        print()
        print(f"ERROR: No result received within {max_poll_wait} seconds.")
        print("Check worker logs above for errors.")
        sys.exit(1)

    print()
    banner("Test complete")


if __name__ == "__main__":
    main()
