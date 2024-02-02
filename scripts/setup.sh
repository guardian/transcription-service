#/usr/bin/env bash
set -e

SCRIPT_PATH=$( cd $(dirname $0) ; pwd -P )

npm install

dev-nginx setup-app nginx/nginx-mapping.yml