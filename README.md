# Kubernetes AI Troubleshooter

AI Kubernetes Troubleshooter runs as a dedicated pod in a Kubernetes cluster and acts like an intelligent Kubernetes support engineer.

It monitors cluster objects, pod logs, events, node status, deployments, services, PVCs, Prometheus metrics, and generates root cause analysis with recommended fixes.

## Features

- React UI dashboard
- FastAPI backend
- Kubernetes API integration
- Prometheus query support
- AI chat troubleshooting
- Root cause rules engine
- Recommendations and suggested kubectl/AWS commands
- Kubernetes RBAC and deployment manifests

## Architecture

```text
User UI -> FastAPI Backend -> Kubernetes API / Prometheus / Logs / Events -> Rules Engine -> LLM Explanation
```

## Main Use Cases

### Pod Pending
Checks:
- Events
- Node capacity
- Taints
- PVC status
- Scheduler messages

Output:
- Reason
- Fix
- Suggested commands

### CrashLoopBackOff
Checks:
- Current logs
- Previous logs
- Events
- Probes
- Env/config issues
- OOMKilled reason

### Node Issues
Checks:
- Ready status
- DiskPressure
- MemoryPressure
- PIDPressure
- Prometheus metrics

### Networking Issues
Checks:
- Service selector
- Endpoints
- Ingress
- NetworkPolicies
- DNS symptoms

## Local Backend Run

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Local Frontend Run

```bash
cd frontend
npm install
npm run dev
```

## Docker Build

```bash
./scripts/build-images.sh
```

## ArgoCD Deployment

ArgoCD should sync this application from the Helm chart in
`helm/k8s-ai-troubleshooter` or the manifests in `k8s/`.

Create the namespace and OpenAI secret in the cluster before syncing:

```bash
kubectl create namespace k8s-ai
kubectl create secret generic k8s-ai-secret \
  -n k8s-ai \
  --from-literal=OPENAI_API_KEY='your-api-key' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Access UI:

```bash
kubectl get svc -n k8s-ai
kubectl port-forward svc/k8s-ai-frontend -n k8s-ai 8080:80
```

Open:

```text
http://localhost:8080
```

## API Example

```bash
curl -X POST http://localhost:8000/api/ai/troubleshoot \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Why is my pod pending?",
    "namespace": "default",
    "pod_name": "my-pod"
  }'
```

## Production Improvements

- Add authentication with Keycloak or OIDC
- Add audit logs before any remediation action
- Add manual approval for auto-fix commands
- Add Loki for container logs
- Add OpenTelemetry collector
- Add PostgreSQL incident history
- Add Redis background workers
- Add Helm chart
- Add multi-cluster support
- Manage production deployment with ArgoCD

---

## GitHub Actions + ArgoCD

This project includes a GitHub Actions pipeline that builds and pushes Docker
images. ArgoCD handles deployment by syncing the chart or manifests from Git.

### Added files

```bash
.github/workflows/build-images.yml
helm/k8s-ai-troubleshooter/Chart.yaml
helm/k8s-ai-troubleshooter/values.yaml
helm/k8s-ai-troubleshooter/values-dev.yaml
helm/k8s-ai-troubleshooter/templates/
```

### GitHub Secrets

No cluster deployment secret is required for this workflow. GitHub Actions uses
the built-in `GITHUB_TOKEN` to push images to GHCR.

| Secret Name | Use |
|---|---|
| OPENAI_API_KEY | Optional only if a separate secret automation workflow uses it |

### GitHub Container Registry

The pipeline pushes images to GitHub Container Registry:

```text
ghcr.io/<github-username>/k8s-ai-backend:<commit-sha>
ghcr.io/<github-username>/k8s-ai-frontend:<commit-sha>
```

### Pipeline Flow

```text
Code Push / Manual Run
        |
Checkout Code
        |
Build Backend Docker Image
        |
Build Frontend Docker Image
        |
Push Images to GHCR
```

### Check Deployment

```bash
kubectl get pods -n k8s-ai
kubectl get svc -n k8s-ai
kubectl logs -n k8s-ai deployment/k8s-ai-backend
```

### Access UI

```bash
kubectl port-forward svc/k8s-ai-frontend -n k8s-ai 8080:80
```

Open:

```text
http://localhost:8080
```

### Upgrade Application

Push code to `main` or run the workflow manually from GitHub Actions. The
pipeline will build and publish new images, and ArgoCD will handle the cluster
sync from Git.

### Rollback

Rollback through ArgoCD or revert the Git change that ArgoCD synced.
