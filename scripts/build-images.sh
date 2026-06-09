#!/usr/bin/env bash
set -euo pipefail
IMAGE_PREFIX=${IMAGE_PREFIX:-k8s-ai}

docker build -t ${IMAGE_PREFIX}-backend:latest ./backend
docker build -t ${IMAGE_PREFIX}-frontend:latest ./frontend
