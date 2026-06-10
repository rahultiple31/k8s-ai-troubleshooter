import os
import asyncio
from datetime import datetime, timedelta, timezone
import httpx

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus-server.monitoring.svc.cluster.local")
COREDNS_SELECTOR = os.getenv("COREDNS_PROMETHEUS_SELECTOR", 'job=~"coredns|kube-dns"')

class PrometheusService:
    async def query(self, promql: str):
        url = f"{PROMETHEUS_URL}/api/v1/query"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, params={"query": promql})
            response.raise_for_status()
            return response.json()

    async def query_range(self, promql: str, minutes: int = 60, step: str = "60s"):
        url = f"{PROMETHEUS_URL}/api/v1/query_range"
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=minutes)
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                url,
                params={
                    "query": promql,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "step": step,
                },
            )
            response.raise_for_status()
            return response.json()

    async def node_cpu(self):
        return await self.query('100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)')

    async def node_memory(self):
        return await self.query('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100')

    async def pod_restarts(self):
        return await self.query('increase(kube_pod_container_status_restarts_total[15m])')

    async def coredns_dashboard(self):
        selector = COREDNS_SELECTOR
        errors = {}

        queries = {
            "requests_by_instance": self.query(f"sum by(instance)(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "requests_by_type": self.query(f"sum by(type)(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "responses_by_code": self.query(f"sum by(rcode)(rate(coredns_dns_responses_total{{{selector}}}[5m]))"),
            "cache_hits": self.query(f"sum(rate(coredns_cache_hits_total{{{selector}}}[5m]))"),
            "cache_misses": self.query(f"sum(rate(coredns_cache_misses_total{{{selector}}}[5m]))"),
            "panics": self.query(f"sum(increase(coredns_panics_total{{{selector}}}[1h]))"),
            "failed_reloads": self.query(f"sum(increase(coredns_reload_failed_total{{{selector}}}[1h]))"),
            "requests_total_range": self.query_range(f"sum(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "responses_range": self.query_range(f"sum by(rcode)(rate(coredns_dns_responses_total{{{selector}}}[5m]))"),
            "cache_hits_range": self.query_range(f"sum(rate(coredns_cache_hits_total{{{selector}}}[5m]))"),
            "cache_misses_range": self.query_range(f"sum(rate(coredns_cache_misses_total{{{selector}}}[5m]))"),
            "memory": self.query(f"sum(process_resident_memory_bytes{{{selector}}})"),
            "cpu": self.query(f"sum(rate(process_cpu_seconds_total{{{selector}}}[5m]))"),
        }
        values = await asyncio.gather(*(safe_call(name, query, errors) for name, query in queries.items()))
        return {
            **dict(zip(queries.keys(), values)),
            "errors": errors,
        }

    async def cluster_dashboard(self):
        errors = {}
        queries = {
            "node_cpu": self.query('100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
            "node_memory": self.query('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'),
            "node_storage": self.query(
                '100 - ((node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} * 100) / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"})'
            ),
            "network_receive": self.query(
                'sum by(instance)(rate(node_network_receive_bytes_total{device!~"lo|veth.*|cali.*|flannel.*|docker.*"}[5m]))'
            ),
            "network_transmit": self.query(
                'sum by(instance)(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|cali.*|flannel.*|docker.*"}[5m]))'
            ),
            "pod_cpu": self.query('sum by(namespace,pod)(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m]))'),
            "pod_memory": self.query('sum by(namespace,pod)(container_memory_working_set_bytes{container!="",pod!=""})'),
            "pod_restarts": self.query('sum by(namespace,pod)(increase(kube_pod_container_status_restarts_total[15m]))'),
            "node_cpu_range": self.query_range('100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
            "node_memory_range": self.query_range('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'),
            "network_receive_range": self.query_range(
                'sum by(instance)(rate(node_network_receive_bytes_total{device!~"lo|veth.*|cali.*|flannel.*|docker.*"}[5m]))'
            ),
            "network_transmit_range": self.query_range(
                'sum by(instance)(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|cali.*|flannel.*|docker.*"}[5m]))'
            ),
            "pod_restarts_range": self.query_range('sum(increase(kube_pod_container_status_restarts_total[15m]))'),
        }
        values = await asyncio.gather(*(safe_call(name, query, errors) for name, query in queries.items()))
        return {
            **dict(zip(queries.keys(), values)),
            "errors": errors,
        }


async def safe_call(name, query, errors):
    try:
        return await query
    except Exception as exc:
        errors[name] = str(exc)
        return {"status": "error", "data": {"result": []}, "error": str(exc)}
