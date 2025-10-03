#!/usr/bin/env bash

set +x
set -e

echo ""
echo "Downloading ffmpeg release and bundling for lambda layer..."
echo ""

WORKING_DIRECTORY="ffmpeg-layer-build"
mkdir -p $WORKING_DIRECTORY

pushd $WORKING_DIRECTORY
curl -0L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz > ffmpeg-release-amd64-static.tar.xz
curl -0L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz.md5 > ffmpeg-release-amd64-static.tar.xz.md5
md5sum -c ffmpeg-release-amd64-static.tar.xz.md5

tar -xf ffmpeg-release-amd64-static.tar.xz

mkdir -p ffmpeg/bin
mkdir -p ffprobe/bin

mkdir -p bin

cp ffmpeg-7.0.2-amd64-static/ffmpeg bin/
cp ffmpeg-7.0.2-amd64-static/ffprobe bin/

zip -r ffmpeg_x86_64.zip bin

HASH=$(md5sum ffmpeg_x86_64.zip | cut -d ' ' -f 1)
NAME_WITH_HASH="ffmpeg_x86_64-$HASH.zip"
mv ffmpeg_x86_64.zip $NAME_WITH_HASH

aws s3 cp ffmpeg_x86_64-$HASH.zip "s3://transcription-service-lambda-layers/${NAME_WITH_HASH}"
popd
rm -rf $WORKING_DIRECTORY

echo ""
echo "Layer zip key: ${NAME_WITH_HASH} - to use this layer you will need to update the FFMpegLayerZipKey parameter in the transcription-service stack"
