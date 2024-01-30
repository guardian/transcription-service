#!/usr/bin/env bash

set -e
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name=transcription-service-task-queue-DEV