# Observability and Application Flow

This document shows how the application works end to end and how it collects
logs, metrics, Kubernetes events, cluster object status, and application data.

## High Level Flow

```mermaid
flowchart TD
    user[Browser user] --> frontendSvc[k8s-ai-frontend Service]
    frontendSvc --> frontendPod[k8s-ai-frontend Pod]
    frontendPod --> backendSvc[k8s-ai-backend Service]
    backendSvc --> backendPod[k8s-ai-backend Pod]

    backendPod --> k8sApi[Kubernetes API Server]
    backendPod --> prometheus[Prometheus Server]
    backendPod --> postgres[(PostgreSQL)]
    backendPod --> redis[(Redis)]
    backendPod --> openai[OpenAI API]

    k8sApi --> podStatus[Pods, Nodes, Deployments, Services, PVCs]
    k8sApi --> events[Kubernetes Events]
    k8sApi --> logs[Container Logs]
    prometheus --> metrics[Cluster and workload metrics]

    podStatus --> rules[Rules Engine]
    events --> rules
    logs --> rules
    metrics --> rules
    rules --> ai[LLM Explanation]
    ai --> backendPod
    backendPod --> frontendPod
    frontendPod --> user
```

## Data Collection Flow

```mermaid
flowchart LR
    ui[React Frontend] --> overview[GET /api/cluster/overview]
    ui --> pods[GET /api/cluster/pods]
    ui --> troubleshoot[POST /api/ai/troubleshoot]
    ui --> prom[GET /api/cluster/prometheus/cluster-dashboard]

    overview --> k8sObjects[Kubernetes API object list]
    pods --> k8sPods[Kubernetes API pod list]

    troubleshoot --> podRead[Read selected pod]
    troubleshoot --> eventRead[Read pod events]
    troubleshoot --> logRead[Read pod logs]
    troubleshoot --> nodeRead[List nodes]
    troubleshoot --> pvcRead[List namespace PVCs]

    podRead --> rules[RulesEngine.analyze_pod]
    eventRead --> rules
    logRead --> rules
    nodeRead --> rules
    pvcRead --> rules

    rules --> llm[LLMService.explain]
    llm --> answer[Reason, fix, commands, confidence]

    prom --> prometheusService[PrometheusService]
    prometheusService --> prometheusApi[Prometheus /api/v1/query]
    prometheusApi --> metricResult[Metric result JSON]
```

## Troubleshooting Request Sequence

```mermaid
sequenceDiagram
    participant User
    participant Frontend as React frontend
    participant Backend as FastAPI backend
    participant K8s as Kubernetes API
    participant Rules as Rules engine
    participant LLM as LLM service

    User->>Frontend: Select namespace and pod
    Frontend->>Backend: POST /api/ai/troubleshoot
    Backend->>K8s: read_namespaced_pod
    Backend->>K8s: list_namespaced_event
    Backend->>K8s: read_namespaced_pod_log
    Backend->>K8s: list_node
    Backend->>K8s: list_namespaced_persistent_volume_claim
    Backend->>Rules: Analyze pod, events, logs, nodes, PVCs
    Rules-->>Backend: Root cause finding
    Backend->>LLM: Explain finding in user-friendly format
    LLM-->>Backend: Final answer
    Backend-->>Frontend: JSON response
    Frontend-->>User: Show reason, fix, and commands
```

## Deployment Flow With ArgoCD

```mermaid
flowchart TD
    push[Developer pushes code to GitHub] --> action[GitHub Actions]
    action --> buildBackend[Build backend image]
    action --> buildFrontend[Build frontend image]
    buildBackend --> dockerhub[Push to Docker Hub]
    buildFrontend --> dockerhub
    dockerhub --> updateValues[Update Helm image tags in values.yaml]
    updateValues --> commit[Commit updated Helm values to Git]
    commit --> argocd[ArgoCD watches Git repo]
    argocd --> sync[ArgoCD syncs Helm chart]
    sync --> cluster[Local Kubernetes cluster]
    cluster --> frontend[k8s-ai-frontend]
    cluster --> backend[k8s-ai-backend]
    cluster --> db[k8s-ai-postgres hostPath volume]
    cluster --> cache[k8s-ai-redis]
```

## Database And Cache Flow

```mermaid
flowchart LR
    backend[k8s-ai-backend] --> dbSvc[k8s-ai-postgres Service]
    dbSvc --> dbPod[k8s-ai-postgres Pod]
    dbPod --> hostPath[/Ubuntu node path: /var/lib/k8s-ai/postgres/]

    backend --> redisSvc[k8s-ai-redis Service]
    redisSvc --> redisPod[k8s-ai-redis Pod]

    values[Helm values.yaml] --> dbEnv[DATABASE_URL]
    values --> redisEnv[REDIS_URL]
    dbEnv --> backend
    redisEnv --> backend
```

PostgreSQL currently uses `hostPath` by default for local Kubernetes clusters.
That avoids the error where a pod stays pending because no default
`StorageClass` exists.

## What Collects What

| Data type | Current source | Current code path | Notes |
|---|---|---|---|
| Pod status | Kubernetes API | `backend/app/services/k8s_client.py` -> `get_pod`, `list_pods` | Used by overview and troubleshooting |
| Node status | Kubernetes API | `backend/app/services/k8s_client.py` -> `list_nodes` | Used by overview and troubleshooting |
| Deployments | Kubernetes API | `backend/app/services/k8s_client.py` -> `list_deployments` | Used by overview |
| Services | Kubernetes API | `backend/app/services/k8s_client.py` -> `list_services` | Used by overview |
| PVC status | Kubernetes API | `backend/app/services/k8s_client.py` -> `list_pvcs` | Used for Pending pod and storage issues |
| Kubernetes events | Kubernetes API | `backend/app/services/k8s_client.py` -> `get_pod_events` | Used by rules engine |
| Container logs | Kubernetes API | `backend/app/services/k8s_client.py` -> `get_pod_logs` | Reads current pod logs directly from Kubernetes |
| Metrics | Prometheus API | `backend/app/services/prometheus.py` | Exposed for cluster, node, pod, networking, and CoreDNS dashboard data |
| AI explanation | LLM service | `backend/app/services/llm.py` | Explains rule output |
| Database | PostgreSQL | Helm `DATABASE_URL` env var | Configured, but incident-history persistence is still a future improvement |
| Cache or queue | Redis | Helm `REDIS_URL` env var | Configured for future background jobs/cache |
| Central log store | Loki | Helm `LOKI_URL` env var | Configured as env only; backend Loki collection is not implemented yet |

## Important Current Behavior

- Logs are not collected from Prometheus.
- Kubernetes events are not collected from Prometheus.
- Prometheus is used for metrics queries only.
- The main implemented Prometheus monitoring endpoint is:

```text
GET /api/cluster/prometheus/cluster-dashboard
```

The backend reads `PROMETHEUS_URL` first, then falls back through common
in-cluster Prometheus service names. You can also set `PROMETHEUS_URLS` to a
comma-separated list when your Prometheus service uses a custom name.

- The main troubleshooting endpoint is:

```text
POST /api/ai/troubleshoot
```

It collects pod status, pod events, pod logs, nodes, and PVCs, then sends that
data to the rules engine and LLM explanation service.

## Verify Data Sources In The Cluster

Check application pods:

```bash
kubectl get pods -n k8s-ai
```

Check backend logs:

```bash
kubectl logs -n k8s-ai deployment/k8s-ai-backend
```

Check Kubernetes events:

```bash
kubectl get events -A --sort-by=.lastTimestamp
```

Check Prometheus pod and service:

```bash
kubectl get pods -n monitoring
kubectl get svc -n monitoring
```

Check whether the backend can reach Prometheus:

```bash
kubectl exec -n k8s-ai deployment/k8s-ai-backend -- env | grep PROMETHEUS_URL
```

Check PostgreSQL hostPath data on the Ubuntu node:

```bash
sudo ls -lah /var/lib/k8s-ai/postgres
```
