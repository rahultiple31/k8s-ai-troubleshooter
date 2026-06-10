# GitHub Actions and ArgoCD Deployment Strategy

## Goal

Build and publish the AI Kubernetes Troubleshooter images with GitHub Actions.
Deploy the application with ArgoCD by syncing the Helm chart or Kubernetes
manifests from Git.

## Pipeline Responsibilities

1. Build backend Docker image.
2. Build frontend Docker image.
3. Push both images to GitHub Container Registry.
4. Leave application sync to ArgoCD.

## GitHub Secrets

GitHub Actions uses the built-in `GITHUB_TOKEN` to push images to GHCR. No
Kubernetes cluster credentials are required in the workflow.

## Cluster Image Pull Secret

If the GHCR packages are private, create a pull secret once in the target
namespace before ArgoCD syncs the application. The Helm chart and standalone
manifests reference `ghcr-secret` by default.

```bash
kubectl create namespace k8s-ai --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-secret \
  -n k8s-ai \
  --docker-server=ghcr.io \
  --docker-username='<github-username>' \
  --docker-password='<github-token-with-read-packages>' \
  --docker-email='<email>' \
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
