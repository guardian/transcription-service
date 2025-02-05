#!/usr/bin/env bash

set +x
set -e

WORKING_DIRECTORY="ffmpeg-layer-build"
mkdir -p $WORKING_DIRECTORY

pushd $WORKING_DIRECTORY
curl -0L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz > ffmpeg-release-amd64-static.tar.xz
curl -0L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz.md5 > ffmpeg-release-amd64-static.tar.xz.md5
md5sum -c ffmpeg-release-amd64-static.tar.xz.md5

tar -xf ffmpeg-release-amd64-static.tar.xz

mkdir -p ffmpeg/bin
mkdir -p ffprobe/bin

cp ffmpeg-7.0.2-amd64-static/ffmpeg ffmpeg/bin/
cp ffmpeg-7.0.2-amd64-static/ffprobe ffprobe/bin/

zip -r ffmpeg_x86_64.zip ffmpeg ffprobe

HASH=$(md5sum ffmpeg_x86_64.zip | cut -d ' ' -f 1)
mv ffmpeg_x86_64.zip ffmpeg_x86_64-$HASH.zip

aws s3 cp ffmpeg_x86_64-$HASH.zip s3://transcription-service-lambda-layers/ffmpeg_x86_64-$HASH.zip
popd
rm -rf $WORKING_DIRECTORY
