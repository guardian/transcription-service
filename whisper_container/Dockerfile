FROM ubuntu:22.04
WORKDIR /opt

RUN apt-get update
RUN apt-get install -y ffmpeg curl wget git build-essential
RUN git clone https://github.com/ggerganov/whisper.cpp
RUN cd whisper.cpp && make
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh medium
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh large-v2