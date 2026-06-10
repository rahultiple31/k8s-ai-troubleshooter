# GitHub Actions and ArgoCD Deployment Strategy

## Goal

Build and publish the AI Kubernetes Troubleshooter images with GitHub Actions.
Deploy the application with ArgoCD by syncing the Helm chart or Kubernetes
manifests from Git.

## Pipeline Responsibilities

1. Build backend Docker image.
2. Build frontend Docker image.
3. Push both images to GitHub Container Registry.
4. Create or update Kubernetes secrets needed by the ArgoCD-managed app.
5. Leave application sync to ArgoCD.

## GitHub Secrets

GitHub Actions uses the built-in `GITHUB_TOKEN` to push images to GHCR. Add
these repository secrets so the workflow can configure Kubernetes secrets for
the ArgoCD-managed app:

| Secret | Description |
|---|---|
| `KUBECONFIG` | Raw kubeconfig YAML for the target cluster |
| `KUBECONFIG_B64` | Optional fallback: base64-encoded kubeconfig |
| `GHCR_PULL_USERNAME` | GitHub username used by Kubernetes image pulls |
| `GHCR_PULL_TOKEN` | GitHub token with package read access |
| `GHCR_PULL_EMAIL` | Email value for the Docker registry secret |
| `OPENAI_API_KEY` | Optional API key synced to the `k8s-ai-secret` Kubernetes secret |

If `KUBECONFIG`/`KUBECONFIG_B64` or any GHCR pull secret is missing or invalid,
the workflow skips cluster secret setup and only builds/pushes images.

## Cluster Image Pull Secret

If the GHCR packages are private, the workflow creates a pull secret in the
target namespace before ArgoCD syncs the application. The Helm chart and
standalone manifests reference `ghcr-secret` by default.

Recommended: create `KUBECONFIG` by copying the raw contents of your kubeconfig
file into the GitHub secret:

```bash
cat ~/.kube/config
```

On PowerShell:

```powershell
Get-Content "$env:USERPROFILE\.kube\config" -Raw | Set-Clipboard
```

Optional fallback: create `KUBECONFIG_B64` from your kubeconfig:

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
backticks, or command output labels.

The workflow runs the equivalent of:

```bash
kubectl create namespace k8s-ai
kubectl create secret docker-registry ghcr-secret \
  -n k8s-ai \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_PULL_USERNAME" \
  --docker-password="$GHCR_PULL_TOKEN" \
  --docker-email="$GHCR_PULL_EMAIL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Private GHCR images still require `ghcr-secret` to exist in the `k8s-ai`
namespace before ArgoCD-created pods can pull them.

## Helm Chart Components

| Template | Purpose |
|---|---|
| `namespace.yaml` | Creates namespace when `namespaceOverride` is set |
| `rbac.yaml` | ServiceAccount, ClusterRole, ClusterRoleBinding |
| `secret.yaml` | Optional OpenAI secret creation |
| `backend.yaml` | FastAPI backend deployment and service |
| `frontend.yaml` | React frontend deployment and service |
| `postgres-redis.yaml` | PostgreSQL and Redis dependencies |

## Recommended Environments

Use separate values files for each environment:

```bash
values-dev.yaml
values-stage.yaml
values-prod.yaml
```

For production, update:

```yaml
frontend:
  service:
    type: ClusterIP

backend:
  replicaCount: 2

postgres:
  enabled: false
```

Use managed PostgreSQL like AWS RDS for production.

## Production Recommendations

- Use AWS ECR instead of GHCR if running on EKS.
- Use ArgoCD cluster credentials instead of CI kubeconfig deployment access.
- Use External Secrets Operator or Sealed Secrets for secrets.
- Use Ingress Controller instead of NodePort.
- Use managed PostgreSQL and Redis.
- Enable TLS through cert-manager.
- Add resource requests and limits for every pod.
- Add NetworkPolicies.
- Add HPA for backend and frontend.
