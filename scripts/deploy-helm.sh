#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-k8s-ai}
RELEASE=${RELEASE:-k8s-ai-troubleshooter}
BACKEND_IMAGE=${BACKEND_IMAGE:-k8s-ai-backend}
FRONTEND_IMAGE=${FRONTEND_IMAGE:-k8s-ai-frontend}
IMAGE_TAG=${IMAGE_TAG:-latest}

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  kubectl -n "$NAMESPACE" create secret generic k8s-ai-secret \
    --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

helm upgrade --install "$RELEASE" ./helm/k8s-ai-troubleshooter \
  --namespace "$NAMESPACE" \
  --set namespaceOverride="$NAMESPACE" \
  --set backend.image.repository="$BACKEND_IMAGE" \
  --set backend.image.tag="$IMAGE_TAG" \
  --set backend.openai.existingSecret="k8s-ai-secret" \
  --set frontend.image.repository="$FRONTEND_IMAGE" \
  --set frontend.image.tag="$IMAGE_TAG" \
  --wait --timeout 10m
