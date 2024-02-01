FROM debian:bullseye-slim
WORKDIR /worker

#suppress installation prompts
ARG DEBIAN_FRONTEND=noninteractive

# Install package-container dependencies
RUN apt-get update
RUN apt-get install -y ruby-full binutils
RUN gem install fpm


