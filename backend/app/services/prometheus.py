import os
import httpx

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus-server.monitoring.svc.cluster.local")

class PrometheusService:
    async def query(self, promql: str):
        url = f"{PROMETHEUS_URL}/api/v1/query"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, params={"query": promql})
            response.raise_for_status()
            return response.json()

    async def node_cpu(self):
        return await self.query('100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)')

    async def node_memory(self):
        return await self.query('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100')

    async def pod_restarts(self):
        return await self.query('increase(kube_pod_container_status_restarts_total[15m])')
