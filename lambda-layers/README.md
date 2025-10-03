# ffmpeg lambda layer

Ffmpeg (and ffprobe) are very useful tools for working with media files. In order to make use of them on AWS lambda,
they need to be provided as a 'lambda layer' (essentially a zip file with the binaries in it).

This folder contains a script to generate the zip file and push it to S3. If you are publishing a new version of the layer
(e.g. to pull in some updates to ffmpeg) then you will need to run this script, and then update the FFMpegLayerZipKey
parameter on the transcription-service stack.

It probably would be possible to automate this process, but as we don't expect many updates to ffmpeg (I imagine it will
only be necessary when we want to support new media codecs etc), I haven't bothered.
