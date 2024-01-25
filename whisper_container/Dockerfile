FROM ubuntu:22.04
WORKDIR /opt
LABEL com.theguardian.transcription-service.whisper-container="Whisper.cpp container with models downloaded, including ffmpeg"

RUN apt-get update
RUN apt-get install -y ffmpeg curl wget git build-essential
RUN git clone https://github.com/ggerganov/whisper.cpp
RUN cd whisper.cpp && make
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh medium

# Large model not currently in use - but we might want to add it as an option at some point
#RUN bash /opt/whisper.cpp/models/download-ggml-model.sh large-v2