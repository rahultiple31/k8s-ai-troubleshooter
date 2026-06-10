#!/usr/bin/env bash
set -euo pipefail
IMAGE_PREFIX=${IMAGE_PREFIX:-docker.io/rahultipledocker/k8s-ai}
PUSH=${PUSH:-false}

docker build -t ${IMAGE_PREFIX}-backend:latest ./backend
docker build -t ${IMAGE_PREFIX}-frontend:latest ./frontend

if [ "${PUSH}" = "true" ]; then
  docker push ${IMAGE_PREFIX}-backend:latest
  docker push ${IMAGE_PREFIX}-frontend:latest
fi
