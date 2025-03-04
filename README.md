# transcription-service

The guardian transcription service provides a simple user interface for guardian staff members to upload audio/video
files they need a transcript for. It then runs the transcription and notifies the user when it is complete. Transcripts
can then be exported to google drive.

Technically, the tool is a bunch of infrastructure and UI that wraps around [whisperX](https://github.com/m-bain/whisperX)
and [whisper.cpp](https://github.com/ggerganov/whisper.cpp). We're very grateful to @ggerganov and @m-bain for their work
on these projects, which provide the core functionality of the transcription service.

For guardian staff - the runbook is [here](https://docs.google.com/document/d/12UfGuT2FkVaWPonT_fGbtCoO-P2iC8teAzq6FVVZ8rk/edit?tab=t.0).

## Get started

We use localstack to run SQS locally rather than needing to create 'dev' queues in AWS. This is set up via docker.

1. Get Janus creds (for fetching creds from AWS Parameter Store)
2. Use the `scripts/setup.sh` script to install dependencies, set up the nginx mapping and create a docker based sqs queue

```bash
nvm use
scripts/setup.sh
```

3. Run the [express](https://expressjs.com/) backend API:

```bash
npm run api::start
```

4. Run the [Next.js](https://nextjs.org/) frontend:

```bash
npm run client::start
```

If all goes well the frontend is available at https://transcribe.local.dev-gutools.co.uk and the backend is available at https://api.transcribe.local.dev-gutools.co.uk

### Running gpu worker (whisperX) locally

Running the gpu/whisperx worker needs whisperx and associated dependencies to be available. If you have already run
setup.sh then the environment should be setup, and you can run `npm run gpu-worker::start` to activate the python
environment and run the worker. We use [pipenv](https://pipenv.pypa.io) to manage the python environment

The same python environment can be used to test changes to the model download python script.

NOTE: To get the API to actually send messages to the gpu queue, you'll need to update the useWhisperX property in
`config.ts` - either by hard coding it or modifying the value in parameter store.

## Emulating a production deployment

Occasionally you will want to develop something which relies on the specific ways we deploy into production.

When in development we run two web servers, the client nextjs dev server has features like autoreloading on changes and it proxies to the api express server.

In production we only run an express server which serves the client bundle whenever you hit a non-API endpoint. This is so that the clientside can handle routing for non-api endpoints.

If you are writing something that depends specifically on interactions between the API sever and the frontend you may want to check it works in production. First you need to update the config value of `rootUrl` to `https://api.transcribe.local.dev-gutools.co.uk` and then run `npm run emulate-prod-locally`. This will trigger a build and have your express web server provide the frontend bundle, rather than the nextjs server.

Then you can test the app using [https://api.transcribe.local.dev-gutools.co.uk](https://api.transcribe.local.dev-gutools.co.uk)

## Purging local queue

If you change the structure of messages on the queue you'll probably want to purge all local messages. There's a script
for that!

```
./scripts/purge-local-queue.sh
```

## Whisper engine

This project currently makes use of both https://github.com/m-bain/whisperX and https://github.com/ggerganov/whisper.cpp
WhisperX needs to run on a GPU instance with Nvidia Cuda drivers and a mountain of python dependencies installed. To improve
transcript performance, these are baked into the AMI used for the transcription workers - see these prs for further details:

- https://github.com/guardian/amigo/pull/1604
- https://github.com/guardian/amigo/pull/1606
- https://github.com/guardian/amigo/pull/1607

Currently we are trialling whisperx, with the hope of improved performance and speaker diarization support. There is an
intention, assuming whisperx has satisfactory performance, cost and transcript quality, to remove whisper.cpp,
thereby significantly simplifying our current infrastructure and the worker app.
