# GitHub Actions and Helm Deployment Strategy

## Goal

Deploy the AI Kubernetes Troubleshooter using a CI/CD pipeline and Helm chart.

## Pipeline Responsibilities

1. Build backend Docker image.
2. Build frontend Docker image.
3. Push both images to GitHub Container Registry.
4. Connect to Kubernetes using kubeconfig from GitHub Secrets.
5. Create namespace and OpenAI secret.
6. Deploy or upgrade the application using Helm.
7. Validate pods and services.

## GitHub Secrets

| Secret | Description |
|---|---|
| `KUBE_CONFIG` | Base64 encoded kubeconfig file |
| `OPENAI_API_KEY` | OpenAI API key |

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
- Use IRSA instead of static kubeconfig for secure AWS access.
- Use External Secrets Operator or Sealed Secrets for secrets.
- Use Ingress Controller instead of NodePort.
- Use managed PostgreSQL and Redis.
- Enable TLS through cert-manager.
- Add resource requests and limits for every pod.
- Add NetworkPolicies.
- Add HPA for backend and frontend.
