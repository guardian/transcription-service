FROM python:3.12-bookworm
WORKDIR /opt
LABEL com.theguardian.transcription-service.media-download-container="Media download container with yt-dlp, associated dependencies and media download app"

ARG node_version

RUN pip install yt-dlp

RUN apt-get update
RUN apt-get install -y ffmpeg git nodejs npm
RUN npm install -g n yarn
RUN echo "node version: $node_version"
RUN n $node_version

# Setup bgutil-ytdlp-pot-provider provider
RUN git clone --single-branch --branch 1.1.0 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
WORKDIR /opt/bgutil-ytdlp-pot-provider/server
RUN yarn install --frozen-lockfile
RUN yarn tsc

WORKDIR /opt
# Install the bgutil-ytdlp-pot-provider plugin for yt-dlp
RUN python -m pip install -U bgutil-ytdlp-pot-provider

# Install and run media-download app
COPY ./packages/media-download/dist/index.js /opt/media-download.js
CMD node /opt/media-download.js
