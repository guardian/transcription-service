#/usr/bin/env bash

aws sqs purge-queue --queue-url http://localhost:4566/000000000000/transcription-service-task-queue-DEV.fifo --endpoint-url http://localhost:4566
aws sqs purge-queue --queue-url http://localhost:4566/000000000000/transcription-service-output-queue-DEV --endpoint-url http://localhost:4566
aws sqs purge-queue --queue-url http://localhost:4566/000000000000/giant-output-dead-letter-queue-DEV.fifo --endpoint-url http://localhost:4566
aws sqs purge-queue --queue-url http://localhost:4566/000000000000/transcription-service-task-dead-letter-queue-DEV.fifo --endpoint-url http://localhost:4566
aws sqs purge-queue --queue-url http://localhost:4566/000000000000/giant-output-queue-DEV.fifo --endpoint-url http://localhost:4566