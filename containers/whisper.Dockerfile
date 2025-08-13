FROM debian:bookworm-slim
WORKDIR /opt
LABEL com.theguardian.transcription-service.whisper-container="Whisper.cpp container with models downloaded, including ffmpeg"

RUN apt-get update
RUN apt-get install -y ffmpeg wget git build-essential cmake
RUN git clone https://github.com/ggerganov/whisper.cpp
RUN cd whisper.cpp && git reset --hard v1.7.6 && cmake -B build && cmake --build build -j --config Release
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh tiny
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh medium

# Large model not currently in use - but we might want to add it as an option at some point
#RUN bash /opt/whisper.cpp/models/download-ggml-model.sh large-v2
