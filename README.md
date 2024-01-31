# transcription-service

## Running locally
We use localstack to run SQS locally rather than needing to create 'dev' queues in AWS. This is set up via docker.

First, start localstack:
```
docker-compose up d
```
Then (you only need to do this once) create the queue:
```
./scripts/setup-local-stack.sh
```

Then you can run the service API:
```
npm run api::start
```

## Purging local queue
If you change the structure of messages on the queue you'll probably want to purge all local messages. There's a script
for that!

```
./scripts/purge-local-queue.sh
```