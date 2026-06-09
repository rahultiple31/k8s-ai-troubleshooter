# Project Strategy: AI Kubernetes Troubleshooter

## Goal

Build an AI application that runs inside Kubernetes and helps DevOps/SRE teams detect, explain, and fix Kubernetes issues.

## Core Components

1. UI Dashboard
   - Cluster health
   - Node health
   - Pod health
   - Logs and alerts
   - AI chat interface

2. Backend API
   - FastAPI service
   - Kubernetes SDK integration
   - Prometheus integration
   - AI troubleshooting API

3. Troubleshooting Engine
   - Rule-based detection for common issues
   - LLM enhancement for natural language explanation
   - Suggested commands and remediation plans

4. Data Sources
   - Kubernetes API Server
   - Pod logs
   - Events
   - Nodes
   - Deployments
   - Services
   - Ingress
   - Network Policies
   - PVC/PV
   - Prometheus metrics

5. AI Features
   - Root cause analysis
   - Recommendations
   - Step-by-step fix
   - Chat-based questions
   - Confidence score

## Safety Strategy

Auto-fix should not run directly in version 1.

Recommended modes:

1. Read-only mode
   - Analyze only
   - Suggest commands

2. Approval mode
   - AI suggests command
   - User approves
   - Backend runs command using Kubernetes API

3. GitOps mode
   - AI creates pull request
   - Human approves
   - Argo CD deploys

## Example: Pod Pending

Question:
Why is my pod pending?

Checks:
- kubectl describe pod
- kubectl get events
- kubectl get nodes
- kubectl get pvc
- Taints and tolerations
- Resource requests

Output:
Reason: 0/5 nodes available due to insufficient CPU.
Fix: Increase node group or reduce pod CPU request.
Suggested commands:
- kubectl describe pod <pod> -n <namespace>
- kubectl top nodes
- aws eks update-nodegroup-config --cluster-name <cluster> --nodegroup-name <nodegroup> --scaling-config desiredSize=7
