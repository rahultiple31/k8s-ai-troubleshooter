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

GitHub Actions does not connect to the Kubernetes cluster. It only builds and
pushes images to Docker Hub. ArgoCD deploys by syncing the Helm chart from Git.

An ArgoCD Application manifest is provided at
`argocd/k8s-ai-troubleshooter-application.yaml`. It targets the Helm chart,
deploys into `k8s-ai`, prunes old resources, and uses Docker Hub images.

The Helm chart deploys application workloads into the `k8s-ai` namespace by
default. If your pods appear in the `argocd` namespace, resync the ArgoCD
application after this change and enable prune, or delete the old deployments
from `argocd`.

Apply or update the ArgoCD app:

```bash
kubectl apply -f argocd/k8s-ai-troubleshooter-application.yaml
```

Then sync from ArgoCD. If old pods still exist in `argocd`, remove the stale
deployments:

```bash
kubectl delete deployment k8s-ai-backend k8s-ai-frontend -n argocd --ignore-not-found
```

The chart now uses public Docker Hub images by default, so no image pull secret
is required unless you make those Docker Hub repositories private.

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

No Kubernetes cluster secret is required in GitHub Actions. Add these repository
secrets so the workflow can push images to Docker Hub:

| Secret Name | Use |
|---|---|
| DOCKERHUB_USERNAME | Docker Hub username or organization |
| DOCKERHUB_TOKEN | Docker Hub access token |

The workflow pushes to the Docker Hub namespace configured as
`DOCKERHUB_NAMESPACE` in `.github/workflows/build-images.yml`, currently
`rahultipledocker`, which matches the Helm values.

After both images are pushed, the workflow updates
`helm/k8s-ai-troubleshooter/values.yaml` and `values-dev.yaml` with the commit
SHA image tag, commits that change with `[skip ci]`, and pushes it back to Git.
ArgoCD automated sync then deploys that exact image tag.

### Docker Hub

The pipeline pushes images to Docker Hub:

```text
docker.io/<dockerhub-username>/k8s-ai-backend:<commit-sha>
docker.io/<dockerhub-username>/k8s-ai-frontend:<commit-sha>
```

The Helm chart currently defaults to `docker.io/rahultipledocker/...`. If your
Docker Hub namespace is different, update `DOCKERHUB_NAMESPACE` in the workflow
and override `backend.image.repository` and `frontend.image.repository` in
ArgoCD or in a values file.

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
Push Images to Docker Hub
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
pipeline will build and publish new images, update the Helm image tags in Git,
and ArgoCD will automatically sync the changed chart.

### Rollback

Rollback through ArgoCD or revert the Git change that ArgoCD synced.
