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

## Kubernetes Deploy

Update your OpenAI key first:

```bash
kubectl create namespace k8s-ai
kubectl create secret generic k8s-ai-secret \
  -n k8s-ai \
  --from-literal=OPENAI_API_KEY='your-api-key' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Then deploy:

```bash
./scripts/deploy.sh
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
- Add GitOps deployment with Argo CD

---

## GitHub Actions + Helm Deployment

This project includes a GitHub Actions pipeline and Helm chart for production-style deployment.

### Added files

```bash
.github/workflows/build-and-deploy-helm.yml
helm/k8s-ai-troubleshooter/Chart.yaml
helm/k8s-ai-troubleshooter/values.yaml
helm/k8s-ai-troubleshooter/values-dev.yaml
helm/k8s-ai-troubleshooter/templates/
scripts/deploy-helm.sh
```

### Required GitHub Secrets

Go to:

```text
GitHub Repository → Settings → Secrets and variables → Actions → New repository secret
```

Create these secrets:

| Secret Name | Use |
|---|---|
| KUBE_CONFIG | Base64 encoded kubeconfig file |
| OPENAI_API_KEY | OpenAI API key for AI troubleshooting |

### Create KUBE_CONFIG Secret

Run this command from your local machine where kubectl is already configured:

```bash
cat ~/.kube/config | base64 -w 0
```

Copy the output and save it as GitHub secret:

```text
KUBE_CONFIG
```

For macOS:

```bash
cat ~/.kube/config | base64
```

### GitHub Container Registry

The pipeline pushes images to GitHub Container Registry:

```text
ghcr.io/<github-username>/k8s-ai-backend:<commit-sha>
ghcr.io/<github-username>/k8s-ai-frontend:<commit-sha>
```

### Pipeline Flow

```text
Code Push / Manual Run
        ↓
Checkout Code
        ↓
Build Backend Docker Image
        ↓
Build Frontend Docker Image
        ↓
Push Images to GHCR
        ↓
Configure kubeconfig
        ↓
Create Namespace
        ↓
Create OpenAI Secret
        ↓
Helm Lint
        ↓
Helm Upgrade Install
        ↓
Check Pod and Service Status
```

### Manual Helm Deployment

```bash
export NAMESPACE=k8s-ai
export BACKEND_IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/k8s-ai-backend
export FRONTEND_IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/k8s-ai-frontend
export IMAGE_TAG=latest
export OPENAI_API_KEY="your-api-key"

./scripts/deploy-helm.sh
```

### Direct Helm Command

```bash
helm upgrade --install k8s-ai-troubleshooter ./helm/k8s-ai-troubleshooter \
  --namespace k8s-ai \
  --create-namespace \
  --set namespaceOverride=k8s-ai \
  --set backend.image.repository=ghcr.io/YOUR_GITHUB_USERNAME/k8s-ai-backend \
  --set backend.image.tag=latest \
  --set backend.openai.existingSecret=k8s-ai-secret \
  --set frontend.image.repository=ghcr.io/YOUR_GITHUB_USERNAME/k8s-ai-frontend \
  --set frontend.image.tag=latest \
  --wait --timeout 10m
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

Push code to `main` or run the workflow manually from GitHub Actions. The pipeline will build new images and run:

```bash
helm upgrade --install
```

### Rollback

```bash
helm history k8s-ai-troubleshooter -n k8s-ai
helm rollback k8s-ai-troubleshooter 1 -n k8s-ai
```

### Uninstall

```bash
helm uninstall k8s-ai-troubleshooter -n k8s-ai
kubectl delete namespace k8s-ai
```
