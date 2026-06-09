#!/usr/bin/env bash
set -euo pipefail
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres-redis.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl get pods -n k8s-ai
