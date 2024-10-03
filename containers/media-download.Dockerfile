FROM python:3.12-bookworm
WORKDIR /opt
LABEL com.theguardian.transcription-service.media-download-container="Media download container with yt-dlp, associated dependnencies and media download app"

ARG node_version

RUN pip install yt-dlp

RUN apt-get update
RUN apt-get install -y ffmpeg git nodejs npm
RUN npm install -g n
RUN echo "node version: $node_version"
RUN n $node_version

COPY ./packages/media-download/dist/index.js /opt/media-download.js

CMD node /opt/media-download.js
