# GitHub Actions and ArgoCD Deployment Strategy

## Goal

Build and publish the AI Kubernetes Troubleshooter images to Docker Hub with GitHub Actions.
Deploy the application with ArgoCD by syncing the Helm chart or Kubernetes
manifests from Git.

## Pipeline Responsibilities

1. Build backend Docker image.
2. Build frontend Docker image.
3. Push both images to Docker Hub.
4. Leave application sync to ArgoCD.

## ArgoCD Application

Use the provided Application manifest:

```bash
kubectl apply -f argocd/k8s-ai-troubleshooter-application.yaml
```

It syncs `helm/k8s-ai-troubleshooter`, deploys workloads into `k8s-ai`, enables
prune/self-heal, and uses Docker Hub images. If a previous sync created
`argocd/k8s-ai-backend` or `argocd/k8s-ai-frontend`, delete those stale
deployments after syncing:

```bash
kubectl delete deployment k8s-ai-backend k8s-ai-frontend -n argocd --ignore-not-found
```

## GitHub Secrets

No Kubernetes cluster credentials are required in the workflow. Add these
repository secrets so GitHub Actions can push images to Docker Hub:

| Secret | Description |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username or organization |
| `DOCKERHUB_TOKEN` | Docker Hub access token |

The workflow pushes to the Docker Hub namespace configured as
`DOCKERHUB_NAMESPACE` in `.github/workflows/build-images.yml`, currently
`rahultipledocker`, which matches the Helm values.

After image push, the workflow commits the new commit-SHA image tag into
`helm/k8s-ai-troubleshooter/values.yaml` and `values-dev.yaml`. The commit uses
`[skip ci]` so it does not start another build loop. ArgoCD automated sync then
deploys the updated Helm chart.

## Docker Hub Images

The pipeline pushes:

```text
docker.io/<dockerhub-username>/k8s-ai-backend:<commit-sha>
docker.io/<dockerhub-username>/k8s-ai-frontend:<commit-sha>
```

The Helm chart deploys application workloads into `k8s-ai` by default and uses
`docker.io/rahultipledocker/...` image repositories. If your Docker Hub username is
different, update `DOCKERHUB_NAMESPACE` in the workflow and override
`backend.image.repository` and `frontend.image.repository` in ArgoCD or in a
values file.

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

- Use AWS ECR instead of Docker Hub if running on EKS.
- Use ArgoCD cluster credentials instead of CI kubeconfig deployment access.
- Use External Secrets Operator or Sealed Secrets for secrets.
- Use Ingress Controller instead of NodePort.
- Use managed PostgreSQL and Redis.
- Enable TLS through cert-manager.
- Add resource requests and limits for every pod.
- Add NetworkPolicies.
- Add HPA for backend and frontend.
