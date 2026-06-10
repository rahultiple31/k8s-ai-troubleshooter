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

The GitHub Actions workflow can create the namespace and Kubernetes secrets
before ArgoCD syncs the app. Add these repository secrets in GitHub to enable
that step:

| Secret Name | Use |
|---|---|
| KUBECONFIG_B64 | Base64-encoded kubeconfig or raw kubeconfig YAML for the target cluster |
| GHCR_PULL_USERNAME | GitHub username used by Kubernetes to pull private GHCR images |
| GHCR_PULL_TOKEN | GitHub token with package read access |
| GHCR_PULL_EMAIL | Email value for the Docker registry secret |
| OPENAI_API_KEY | Optional API key stored as the `k8s-ai-secret` Kubernetes secret |

Create `KUBECONFIG_B64` from your kubeconfig:

```bash
base64 -w 0 ~/.kube/config
```

On PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.kube\config"))
```

On PowerShell, you can copy it directly to the clipboard:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.kube\config")) | Set-Clipboard
```

Paste only the base64 text into the GitHub secret. Do not include quotes,
backticks, or command output labels. The workflow also accepts raw kubeconfig
YAML in `KUBECONFIG_B64`, but base64 is safer for copy/paste.

The workflow creates or updates this cluster secret automatically:

```bash
kubectl create secret docker-registry ghcr-secret \
  -n k8s-ai \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_PULL_USERNAME" \
  --docker-password="$GHCR_PULL_TOKEN" \
  --docker-email="$GHCR_PULL_EMAIL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

If any of `KUBECONFIG_B64`, `GHCR_PULL_USERNAME`, `GHCR_PULL_TOKEN`, or
`GHCR_PULL_EMAIL` is missing, the workflow skips cluster secret setup and only
builds/pushes images. Private GHCR images still require `ghcr-secret` to exist
in the `k8s-ai` namespace before pods can pull them.

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

GitHub Actions uses the built-in `GITHUB_TOKEN` to push images to GHCR. The
following repository secrets are used to configure Kubernetes secrets for
ArgoCD-managed deployments:

| Secret Name | Use |
|---|---|
| KUBECONFIG_B64 | Base64-encoded kubeconfig or raw kubeconfig YAML for the target cluster |
| GHCR_PULL_USERNAME | GitHub username used by Kubernetes image pulls |
| GHCR_PULL_TOKEN | GitHub token with package read access |
| GHCR_PULL_EMAIL | Email value for the Docker registry secret |
| OPENAI_API_KEY | Optional API key synced to the `k8s-ai-secret` Kubernetes secret |

The cluster secret configuration job is skipped when the required Kubernetes
and GHCR pull secrets are not set, so image builds can still pass.

### GitHub Container Registry

The pipeline pushes images to GitHub Container Registry:

```text
ghcr.io/<github-username>/k8s-ai-backend:<commit-sha>
ghcr.io/<github-username>/k8s-ai-frontend:<commit-sha>
```

If the GHCR packages are private, the cluster must have a `ghcr-secret`
image pull secret in the application namespace. The workflow creates that
secret from GitHub repository secrets, and the Helm chart and standalone
manifests reference it by default.

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
