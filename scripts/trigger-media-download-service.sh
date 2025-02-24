#!/usr/bin/env bash

URL=$1
USER_EMAIL=$2

if [ -z "$URL" ] || [ -z "$USER_EMAIL" ]; then
  echo "Usage: trigger-media-download-service.sh <url> <user-email>"
  exit 1
fi

export MESSAGE_BODY="{\"id\":\"a168f62d-e179-46d5-9a9e-ff519551e0ee\",\"url\":\"${URL}\",\"languageCode\":\"en\",\"translationRequested\":false,\"diarizationRequested\":false,\"userEmail\":\"${USER_EMAIL}\"}"
npm run media-download::start
