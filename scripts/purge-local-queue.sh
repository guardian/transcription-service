#!/bin/zsh

aws sqs purge-queue --queue-url http://localhost:4566/000000000000/transcription-service-task-queue-DEV --endpoint-url http://localhost:4566