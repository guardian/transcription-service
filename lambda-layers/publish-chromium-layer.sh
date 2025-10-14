set +x
set -e

WORKING_DIRECTORY="chromium-layer-build"
mkdir -p $WORKING_DIRECTORY

pushd $WORKING_DIRECTORY

ZIP_NAME="chromium-v140.0.0-layer.arm64.zip"

wget https://github.com/Sparticuz/chromium/releases/download/v140.0.0/$ZIP_NAME


aws s3 cp $ZIP_NAME "s3://transcription-service-lambda-layers/${ZIP_NAME}"
popd
rm -rf $WORKING_DIRECTORY

echo ""
echo "Layer zip key: ${ZIP_NAME} - to use this layer you will need to update the ChromiumLayerZipKey parameter in the transcription-service stack"
