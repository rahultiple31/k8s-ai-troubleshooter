import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Network,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || '/api';

async function fetchClusterJson(path){
  const response=await fetch(`${API}${path}`);
  if(!response.ok){
    throw new Error(`${path} request failed`);
  }
  return response.json();
}

function App(){
  const [activeView,setActiveView]=useState('dashboard');
  const [overview,setOverview]=useState({});
  const [pods,setPods]=useState([]);
  const [services,setServices]=useState([]);
  const [deployments,setDeployments]=useState([]);
  const [events,setEvents]=useState([]);
  const [question,setQuestion]=useState('Fix this Kubernetes pod issue and provide copy-paste kubectl commands.');
  const [namespace,setNamespace]=useState('default');
  const [podName,setPodName]=useState('');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [loadingCluster,setLoadingCluster]=useState(false);
  const [refreshError,setRefreshError]=useState('');
  const [lastRefresh,setLastRefresh]=useState(null);
  const selectedRef=useRef({namespace:'default',podName:''});
  const [messages,setMessages]=useState([
    {
      role:'assistant',
      content:{
        reason:'Ask me to fix a Kubernetes issue.',
        fix:'I will inspect live pod status, events, logs, nodes, PVCs, and return the exact fix with copy-paste kubectl commands.',
        commands:['kubectl get pods -A','kubectl get events -A --sort-by=.lastTimestamp'],
        confidence:100,
      },
    },
  ]);

  async function load(){
    setLoadingCluster(true);
    setRefreshError('');
    const requests=[
      ['overview', fetchClusterJson('/cluster/overview')],
      ['pods', fetchClusterJson('/cluster/pods')],
      ['services', fetchClusterJson('/cluster/services')],
      ['deployments', fetchClusterJson('/cluster/deployments')],
      ['events', fetchClusterJson('/cluster/events')],
    ];

    try {
      const results=await Promise.allSettled(requests.map(([,request])=>request));
      const failures=[];
      const [overviewResult,podsResult,servicesResult,deploymentsResult,eventsResult]=results;

      if(overviewResult.status==='fulfilled') setOverview(overviewResult.value); else failures.push('overview');
      if(podsResult.status==='fulfilled') setPods(podsResult.value); else failures.push('pods');
      if(servicesResult.status==='fulfilled') setServices(servicesResult.value); else failures.push('services');
      if(deploymentsResult.status==='fulfilled') setDeployments(deploymentsResult.value); else failures.push('deployments');
      if(eventsResult.status==='fulfilled') setEvents(eventsResult.value); else failures.push('events');

      setLastRefresh(new Date());
      if(podsResult.status==='fulfilled' && !selectedRef.current.podName && podsResult.value.length){
        const preferredPod=podsResult.value.find(item=>item.namespace===selectedRef.current.namespace) || podsResult.value[0];
        selectedRef.current={namespace:preferredPod.namespace,podName:preferredPod.name};
        setNamespace(preferredPod.namespace);
        setPodName(preferredPod.name);
      }

      if(failures.length){
        setRefreshError(`Partial refresh: ${failures.join(', ')} unavailable`);
      }
    } catch (err) {
      setRefreshError(err.message || 'Unable to refresh cluster data');
    } finally {
      setLoadingCluster(false);
    }
  }

  useEffect(()=>{
    load();
    const timer=setInterval(load,15000);
    return()=>clearInterval(timer);
  },[]);

  const filteredPods=useMemo(()=>{
    const needle=search.trim().toLowerCase();
    if(!needle) return pods;
    return pods.filter(p=>
      [p.namespace,p.name,p.phase,p.node].some(value=>
        String(value || '').toLowerCase().includes(needle)
      )
    );
  },[pods,search]);

  const filteredServices=useMemo(
    ()=>filterResources(services,search,['namespace','name','type','cluster_ip']),
    [services,search]
  );

  const filteredDeployments=useMemo(
    ()=>filterResources(deployments,search,['namespace','name']),
    [deployments,search]
  );

  const filteredEvents=useMemo(
    ()=>filterResources(events,search,['namespace','reason','message','object_kind','object_name','type']),
    [events,search]
  );

  const selectedPod=useMemo(
    ()=>pods.find(p=>p.namespace===namespace && p.name===podName),
    [pods,namespace,podName]
  );

  const unhealthyPods=pods.filter(p=>p.phase!=='Running' && p.phase!=='Succeeded').length;
  const nodeIssueCount=(overview.not_ready_nodes || []).length;
  const syncOk=unhealthyPods===0 && nodeIssueCount===0;

  function selectPod(p){
    selectedRef.current={namespace:p.namespace,podName:p.name};
    setNamespace(p.namespace);
    setPodName(p.name);
    setQuestion(`Fix the Kubernetes issue for pod ${p.name} in namespace ${p.namespace}. Current phase is ${p.phase}. Give root cause, exact fix, and copy-paste kubectl commands.`);
  }

  function selectNamespace(nextNamespace){
    selectedRef.current={namespace:nextNamespace,podName:''};
    setNamespace(nextNamespace);
    setPodName('');
    setQuestion(`Find and fix Kubernetes issues in namespace ${nextNamespace}. Give exact kubectl commands I can copy and paste.`);
  }

  function updateNamespace(value){
    selectedRef.current={...selectedRef.current,namespace:value};
    setNamespace(value);
  }

  function updatePodName(value){
    selectedRef.current={...selectedRef.current,podName:value};
    setPodName(value);
  }

  async function askAI(nextQuestion){
    const submittedQuestion=(typeof nextQuestion==='string' ? nextQuestion : question).trim();
    if(!submittedQuestion) return;
    const userMessage={role:'user',content:{question:submittedQuestion,namespace,pod_name:podName}};
    setMessages(current=>[...current,userMessage]);
    setQuestion('');
    setLoading(true);
    try {
      const res=await fetch(`${API}/ai/troubleshoot`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:submittedQuestion, namespace, pod_name:podName}),
      });
      const data=await res.json();
      setMessages(current=>[
        ...current,
        {role:'assistant',content:res.ok ? data : {error:data.detail || 'Troubleshooting request failed'}},
      ]);
    } catch (err) {
      setMessages(current=>[
        ...current,
        {role:'assistant',content:{error:`Unable to reach backend: ${err.message}`}},
      ]);
    } finally {
      setLoading(false);
    }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Bot size={24}/></div>
        <div>
          <h1>K8s AI</h1>
          <p>Cluster support console</p>
        </div>
      </div>

      <nav className="nav">
        <NavButton active={activeView==='dashboard'} icon={<LayoutDashboard size={18}/>} label="Applications" onClick={()=>setActiveView('dashboard')} />
        <NavButton active={activeView==='ai'} icon={<MessageSquareText size={18}/>} label="AI Troubleshoot" onClick={()=>setActiveView('ai')} />
        <NavButton active={activeView==='resources'} icon={<Network size={18}/>} label="Resource Tree" onClick={()=>setActiveView('resources')} />
        <NavButton active={activeView==='events'} icon={<History size={18}/>} label="Events" onClick={()=>setActiveView('events')} />
        <NavButton active={activeView==='monitoring'} icon={<BarChart3 size={18}/>} label="Monitoring" onClick={()=>setActiveView('monitoring')} />
        <NavButton active={activeView==='terminal'} icon={<Terminal size={18}/>} label="Kubectl Terminal" onClick={()=>setActiveView('terminal')} />
      </nav>

      <div className="filter-block">
        <span>Resource filters</span>
        <label>
          <Search size={16}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search resources" />
        </label>
      </div>

      <div className="sidebar-summary">
        <span>Cluster summary</span>
        <HealthTile label="App Health" value={syncOk ? 'Healthy' : 'Issue'} icon={<ShieldCheck/>} tone={syncOk ? 'good' : 'bad'} />
        <HealthTile label="Sync Status" value={syncOk ? 'Working' : 'Check'} icon={<GitBranch/>} tone={syncOk ? 'good' : 'warn'} />
        <HealthTile label="Nodes" value={overview.nodes ?? '-'} icon={<Server/>} tone={nodeIssueCount ? 'warn' : 'info'} />
        <HealthTile label="Pods" value={overview.pods ?? pods.length ?? '-'} icon={<Boxes/>} tone={unhealthyPods ? 'bad' : 'info'} />
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div>
          <div className="crumbs">Applications <ChevronRight size={15}/> k8s-ai-troubleshooter</div>
          <h2>{viewTitle(activeView)}</h2>
          {refreshError && <p className="refresh-error">{refreshError}</p>}
        </div>
        <button className="icon-button" onClick={load} disabled={loadingCluster} title="Refresh cluster data">
          <RefreshCw className={loadingCluster ? 'spin' : ''} size={18}/>
          {loadingCluster ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      <section className={`content-grid ${activeView==='terminal' ? 'terminal-split' : activeView!=='dashboard' ? 'single' : ''}`}>
        {(activeView==='dashboard' || activeView==='ai') && <ChatPanel
          messages={messages}
          loading={loading}
          namespace={namespace}
          podName={podName}
          question={question}
          setQuestion={setQuestion}
          updateNamespace={updateNamespace}
          updatePodName={updatePodName}
          askAI={askAI}
        />}

        {(activeView==='dashboard' || activeView==='resources') && <ResourcePanel
          pods={filteredPods}
          services={filteredServices}
          deployments={filteredDeployments}
          selectedPod={selectedPod}
          selectedNamespace={namespace}
          lastRefresh={lastRefresh}
          onSelectPod={selectPod}
          onSelectNamespace={selectNamespace}
        />}

        {activeView==='events' && <EventsPanel events={filteredEvents} lastRefresh={lastRefresh} />}

        {activeView==='monitoring' && <MonitoringPanel
          overview={overview}
          pods={pods}
          services={services}
          events={events}
          lastRefresh={lastRefresh}
        />}

        {activeView==='terminal' && <>
          <TerminalPanel
            namespace={namespace}
            podName={podName}
            onAskFix={(commandResult)=>askAI(buildTerminalFixPrompt(commandResult, namespace, podName))}
          />
          <ChatPanel
            messages={messages}
            loading={loading}
            namespace={namespace}
            podName={podName}
            question={question}
            setQuestion={setQuestion}
            updateNamespace={updateNamespace}
            updatePodName={updatePodName}
            askAI={askAI}
          />
        </>}
      </section>
    </main>
  </div>;
}

function viewTitle(activeView){
  if(activeView==='ai') return 'AI Troubleshoot';
  if(activeView==='resources') return 'Resource Tree';
  if(activeView==='events') return 'Events';
  if(activeView==='monitoring') return 'Monitoring';
  if(activeView==='terminal') return 'Kubectl Terminal';
  return 'Kubernetes AI Troubleshooter';
}

function NavButton({active,icon,label,onClick}){
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} type="button">
    {icon}
    <span>{label}</span>
  </button>;
}

function filterResources(items,search,fields){
  const needle=search.trim().toLowerCase();
  if(!needle) return items;
  return items.filter(item=>
    fields.some(field=>String(item[field] || '').toLowerCase().includes(needle))
  );
}

function buildFixPrompt(issue, namespace, podName){
  const target = podName
    ? `pod ${podName} in namespace ${namespace || 'default'}`
    : `namespace ${namespace || 'default'}`;
  return `${issue} for ${target}. Give the root cause, exact fix steps, and copy-paste kubectl commands with the real namespace and pod name.`;
}

function buildTerminalFixPrompt(commandResult, namespace, podName){
  const output = [commandResult.stdout, commandResult.stderr].filter(Boolean).join('\n').slice(0,5000);
  const target = podName
    ? `pod ${podName} in namespace ${namespace || 'default'}`
    : `namespace ${namespace || 'default'}`;
  return [
    `Fix this Kubernetes issue for ${target}.`,
    `Command: ${commandResult.command}`,
    `Exit code: ${commandResult.exit_code}`,
    'Kubectl output:',
    output || 'No output returned.',
    'Give the root cause, exact fix steps, and copy-paste kubectl commands.',
  ].join('\n');
}

function HealthTile({label,value,icon,tone}){
  return <div className={`health-tile ${tone || ''}`}>
    <div className="tile-icon">{icon}</div>
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  </div>;
}

function ChatPanel({messages,loading,namespace,podName,question,setQuestion,updateNamespace,updatePodName,askAI}){
  const endRef=useRef(null);
  const hasUserMessage=messages.some(message=>message.role==='user');
  const visibleMessages=hasUserMessage ? messages.filter(message=>message.role==='user' || message.content?.ai_explanation || message.content?.error) : [];
  const promptIdeas=[
    'Fix CrashLoopBackOff for this pod',
    'Fix ImagePullBackOff or registry secret issue',
    'Fix Pending pod caused by PVC or storage',
    'Fix service or endpoint connectivity',
  ];

  useEffect(()=>{
    endRef.current?.scrollIntoView({behavior:'smooth', block:'end'});
  },[messages,loading]);

  function handlePromptKeyDown(event){
    if(event.key==='Enter' && !event.shiftKey){
      event.preventDefault();
      askAI();
    }
  }

  return <section className="chat-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Kubernetes fix assistant</span>
        <h3>Fix cluster issue</h3>
      </div>
      <span className="selected-pill">{namespace || '-'} / {podName || 'select pod'}</span>
    </div>

    <div className="messages">
      {!hasUserMessage && <div className="chat-welcome">
        <div className="welcome-mark"><Sparkles size={24}/></div>
        <h3>Which Kubernetes issue should I fix?</h3>
        <p>Select a pod or type the namespace and pod name. I will return the root cause, exact fix steps, and copy-paste kubectl commands for that Kubernetes problem.</p>
        <div className="prompt-suggestions">
          {promptIdeas.map(prompt=>
            <button key={prompt} type="button" onClick={()=>setQuestion(buildFixPrompt(prompt, namespace, podName))}>{prompt}</button>
          )}
        </div>
      </div>}

      {visibleMessages.map((msg,index)=>
        <ChatMessage key={`${msg.role}-${index}`} message={msg} />
      )}
      {loading && <div className="message assistant">
        <div className="avatar"><Loader2 className="spin" size={18}/></div>
        <div className="bubble muted">Analyzing live cluster data and matching it with Kubernetes troubleshooting guidance...</div>
      </div>}
      <div ref={endRef} />
    </div>

    <div className="composer">
      <div className="target-row">
        <input value={namespace} onChange={e=>updateNamespace(e.target.value)} placeholder="namespace" />
        <input value={podName} onChange={e=>updatePodName(e.target.value)} placeholder="pod name" />
      </div>
      <div className="composer-suggestions">
        {promptIdeas.map(prompt=>
          <button key={prompt} type="button" onClick={()=>setQuestion(buildFixPrompt(prompt, namespace, podName))}>{prompt}</button>
        )}
      </div>
      <div className="prompt-row">
        <textarea
          value={question}
          onChange={e=>setQuestion(e.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask me to fix a Kubernetes issue: CrashLoopBackOff, ImagePullBackOff, Pending PVC, probes, service endpoints, OOMKilled..."
        />
        <button onClick={askAI} disabled={loading || !question.trim()} title="Analyze issue">
          {loading ? <Loader2 className="spin" size={19}/> : <Send size={19}/>}
        </button>
      </div>
    </div>
  </section>;
}

function ResourcePanel({pods,services,deployments,selectedPod,selectedNamespace,lastRefresh,onSelectPod,onSelectNamespace}){
  return <section className="ops-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Live resources</span>
        <h3>Resource tree</h3>
      </div>
      <span className="time">{lastRefresh ? lastRefresh.toLocaleTimeString() : 'loading'}</span>
    </div>

    <ResourceGraph
      pods={pods}
      services={services}
      deployments={deployments}
      selectedPod={selectedPod}
      selectedNamespace={selectedNamespace}
      onSelectPod={onSelectPod}
      onSelectNamespace={onSelectNamespace}
    />
  </section>;
}

function EventsPanel({events,lastRefresh}){
  return <section className="events-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Cluster timeline</span>
        <h3>Recent events</h3>
      </div>
      <span className="time">{lastRefresh ? lastRefresh.toLocaleTimeString() : 'loading'}</span>
    </div>
    <div className="event-list">
      {events.map(event=><EventItem key={`${event.namespace}-${event.name}`} event={event} />)}
      {!events.length && <div className="empty">No events found</div>}
    </div>
  </section>;
}

function MonitoringPanel({overview,pods,services,events,lastRefresh}){
  const [metrics,setMetrics]=useState({cluster:null,coredns:null});
  const [loadingMetrics,setLoadingMetrics]=useState(false);
  const [metricError,setMetricError]=useState('');

  async function loadMetrics(){
    setLoadingMetrics(true);
    setMetricError('');
    const [clusterResult,corednsResult]=await Promise.allSettled([
      fetchClusterJson('/cluster/prometheus/cluster-dashboard'),
      fetchClusterJson('/cluster/prometheus/coredns'),
    ]);
    setMetrics(current=>({
      cluster:clusterResult.status==='fulfilled' ? clusterResult.value : current.cluster,
      coredns:corednsResult.status==='fulfilled' ? corednsResult.value : current.coredns,
    }));
    if(clusterResult.status==='rejected' && corednsResult.status==='rejected'){
      setMetricError('Prometheus metrics unavailable from backend.');
    }
    setLoadingMetrics(false);
  }

  useEffect(()=>{
    loadMetrics();
  },[]);

  const cluster=metrics.cluster || {};
  const unhealthyPods=pods.filter(pod=>pod.phase!=='Running' && pod.phase!=='Succeeded');
  const warningEvents=events.filter(event=>(event.type || '').toLowerCase()==='warning');
  const restartRows=prometheusRows(cluster.pod_restarts,['namespace','pod']).filter(row=>row.value>0).slice(0,8);
  const nodeCpuRows=prometheusRows(cluster.node_cpu,['instance']).slice(0,8);
  const nodeMemoryRows=prometheusRows(cluster.node_memory,['instance']).slice(0,8);
  const nodeStorageRows=prometheusRows(cluster.node_storage,['instance']).slice(0,8);
  const podCpuRows=prometheusRows(cluster.pod_cpu,['namespace','pod']).slice(0,8);
  const podMemoryRows=prometheusRows(cluster.pod_memory,['namespace','pod']).slice(0,8);
  const podStorageRows=prometheusRows(cluster.pod_storage,['namespace','pod']).slice(0,8);
  const clusterCpu=firstPromValue(cluster.cluster_cpu) || averageRows(nodeCpuRows);
  const clusterMemory=firstPromValue(cluster.cluster_memory) || averageRows(nodeMemoryRows);
  const clusterStorage=firstPromValue(cluster.cluster_storage) || maxRows(nodeStorageRows);
  const httpErrorRows=combineRows(
    prometheusRows(cluster.http_errors_code,['namespace','service','code']),
    prometheusRows(cluster.http_errors_status,['namespace','service','status']),
  ).slice(0,8);
  const httpsErrorRows=combineRows(
    prometheusRows(cluster.https_errors_code,['namespace','service','code']),
    prometheusRows(cluster.https_errors_status,['namespace','service','status']),
  ).slice(0,8);
  const corednsPods=pods.filter(pod=>/coredns|kube-dns/i.test(pod.name));

  return <section className="monitoring-panel">
    <div className="grafana-heading">
      <div>
        <span>Cluster / Kubernetes</span>
        <h3>Monitoring dashboard</h3>
      </div>
      <div className="grafana-actions">
        <span>Last 1 hour</span>
        <button className="mini-action" type="button" onClick={loadMetrics} disabled={loadingMetrics}>
          <RefreshCw className={loadingMetrics ? 'spin' : ''} size={15}/>
          {loadingMetrics ? 'Loading' : 'Refresh'}
        </button>
      </div>
    </div>

    <div className="grafana-body">
      {metricError && <div className="metric-error">{metricError}</div>}
      <div className="grafana-filter-row">
        <span>Scope</span>
        <strong>all namespaces / cluster resources / last 1 hour</strong>
      </div>

      <DashboardSection title="Cluster health: CPU use, RAM use, storage use">
        <div className="stat-row cluster-health-row">
          <GaugePanel title="CPU Use" value={clusterCpu} suffix="%" />
          <GaugePanel title="RAM Use" value={clusterMemory} suffix="%" />
          <GaugePanel title="Storage Use" value={clusterStorage} suffix="%" />
          <GrafanaStat title="Nodes" value={String(overview.nodes ?? '-')} tone={(overview.not_ready_nodes || []).length ? 'bad' : 'good'} />
          <GrafanaStat title="Unhealthy Pods" value={String(unhealthyPods.length)} tone={unhealthyPods.length ? 'bad' : 'good'} />
          <GrafanaStat title="Warnings" value={String(warningEvents.length)} tone={warningEvents.length ? 'bad' : 'good'} />
        </div>
      </DashboardSection>

      <DashboardSection title="Node: CPU use, RAM use, storage use">
        <div className="grafana-chart-grid">
          <BarPanel title="Node CPU use" rows={nodeCpuRows} unit="%" />
          <BarPanel title="Node RAM use" rows={nodeMemoryRows} unit="%" />
          <BarPanel title="Node storage use" rows={nodeStorageRows} unit="%" />
          <ResourceListPanel title="Node health" rows={[
            {label:'Ready nodes', value:String(Math.max((overview.nodes || 0) - (overview.not_ready_nodes || []).length,0))},
            {label:'Not ready nodes', value:String((overview.not_ready_nodes || []).length)},
          ]} empty="No node health data" />
        </div>
      </DashboardSection>

      <DashboardSection title="Pod: CPU use, RAM use, storage use, Pod health">
        <div className="grafana-chart-grid">
          <BarPanel title="Pod CPU use" rows={podCpuRows} unit="cores" />
          <BarPanel title="Pod RAM use" rows={podMemoryRows.map(row=>({...row,value:row.value / 1024 / 1024}))} unit="MB" />
          <BarPanel title="Pod storage use" rows={podStorageRows.map(row=>({...row,value:row.value / 1024 / 1024}))} unit="MB" />
          <BarPanel title="Pod restarts" rows={restartRows} unit="restarts" />
          <ResourceListPanel title="Pod health" rows={pods.slice(0,10).map(pod=>({
            label:`${pod.namespace}/${pod.name}`,
            value:`${pod.phase} / ${pod.restarts} restarts`,
          }))} empty="No pod health data" />
          <ResourceListPanel title="Warning events" rows={warningEvents.slice(0,10).map(event=>({
            label:`${event.namespace}/${event.object_name || event.name}`,
            value:event.reason,
          }))} empty="No warning events" />
        </div>
      </DashboardSection>

      <DashboardSection title="Pod networking: service and HTTP/HTTPS errors">
        <div className="grafana-chart-grid">
          <ResourceListPanel title="Services" rows={services.slice(0,10).map(service=>({
            label:`${service.namespace}/${service.name}`,
            value:`${service.type} ${service.ports?.map(port=>port.port).join(', ') || ''}`,
          }))} empty="No services" />
          <BarPanel title="HTTP errors 4xx/5xx" rows={httpErrorRows} unit="err/s" />
          <BarPanel title="HTTPS errors 4xx/5xx" rows={httpsErrorRows} unit="err/s" />
        </div>
      </DashboardSection>

      <CoreDnsDashboard coredns={metrics.coredns || {}} pods={corednsPods} />

      <small className="monitoring-time">Last cluster refresh: {lastRefresh ? lastRefresh.toLocaleTimeString() : 'loading'}</small>
    </div>
  </section>;
}

function CoreDnsDashboard({coredns,pods}){
  const requestRows=prometheusRows(coredns.requests_by_instance,['instance','pod']).slice(0,6);
  const requestTypeRows=prometheusRows(coredns.requests_by_type,['type']).slice(0,8);
  const responseRows=prometheusRows(coredns.responses_by_code,['rcode']).slice(0,8);
  const cacheHits=firstPromValue(coredns.cache_hits);
  const cacheMisses=firstPromValue(coredns.cache_misses);
  const cacheTotal=cacheHits + cacheMisses;
  const cacheHitRate=cacheTotal ? (cacheHits / cacheTotal) * 100 : 0;
  const panics=firstPromValue(coredns.panics);
  const failedReloads=firstPromValue(coredns.failed_reloads);
  const healthFailures=firstPromValue(coredns.health_check_failures);
  const upstreamRejected=firstPromValue(coredns.upstream_rejected);
  const cpuMs=firstPromValue(coredns.cpu) * 1000;
  const memory=firstPromValue(coredns.memory);
  const version=firstPromLabel(coredns.build_info,'version') || firstPromLabel(coredns.build_info,'goversion') || 'n/a';
  const cacheSeries=[
    ...rangeSeries(coredns.cache_hits_range,['instance','job']).map(item=>({...item,label:`hits ${item.label}`})),
    ...rangeSeries(coredns.cache_misses_range,['instance','job']).map(item=>({...item,label:`misses ${item.label}`})),
  ];

  return <div className="coredns-dashboard">
    <DashboardSection title="CoreDNS / Grafana-style DNS dashboard">
      <div className="grafana-filter-row">
        <span>Instance</span>
        <strong>{requestRows.map(row=>row.label).join(' + ') || 'CoreDNS metrics'}</strong>
      </div>
      <div className="coredns-global-grid">
        <PiePanel title="Requests by instance" rows={requestRows} />
        <ResourceListPanel title="CoreDNS pods" rows={pods.slice(0,8).map(pod=>({
          label:`${pod.namespace}/${pod.name}`,
          value:`${pod.phase} / ${pod.restarts} restarts`,
        }))} empty="No CoreDNS pods found" />
      </div>
    </DashboardSection>

    <DashboardSection title="CoreDNS health">
      <div className="coredns-health-row">
        <GrafanaStat title="Version" value={version} tone="info" />
        <GrafanaStat title="Health Check Fails" value={formatMetricValue(healthFailures)} tone={healthFailures ? 'bad' : 'good'} />
        <GrafanaStat title="Rejected Queries" value={formatMetricValue(upstreamRejected)} tone={upstreamRejected ? 'bad' : 'good'} />
        <GrafanaStat title="Panics" value={formatMetricValue(panics)} tone={panics ? 'bad' : 'good'} />
        <GrafanaStat title="Failed Reloads" value={formatMetricValue(failedReloads)} tone={failedReloads ? 'bad' : 'good'} />
        <GaugePanel title="CPU Time" value={cpuMs} suffix=" ms" />
        <GrafanaStat title="Memory Usage" value={formatBytes(memory)} tone="info" />
      </div>
    </DashboardSection>

    <DashboardSection title="CoreDNS local traffic">
      <div className="grafana-chart-grid">
        <LinePanel title="Requests total" series={rangeSeries(coredns.requests_total_range,['instance','job'])} unit="req/s" />
        <BarPanel title="Requests by type" rows={requestTypeRows} unit="req/s" />
        <LinePanel title="Responses by code" series={rangeSeries(coredns.responses_range,['rcode'])} unit="req/s" />
        <GaugePanel title="Cache hitrate" value={cacheHitRate} suffix="%" />
        <PiePanel title="Responses by code" rows={responseRows} />
        <LinePanel title="Cache activity" series={cacheSeries} unit="req/s" />
      </div>
    </DashboardSection>
  </div>;
}

function DashboardSection({title,children}){
  return <div className="dashboard-section">
    <div className="dashboard-section-title">v {title}</div>
    {children}
  </div>;
}

function GrafanaStat({title,value,tone}){
  return <div className={`grafana-panel stat-panel ${tone || ''}`}>
    <span>{title}</span>
    <strong>{value}</strong>
  </div>;
}

function PiePanel({title,rows}){
  const total=rows.reduce((sum,row)=>sum + Math.max(row.value,0),0);
  let current=0;
  const gradient=rows.length ? rows.map((row,index)=>{
    const start=current;
    const size=total ? (row.value / total) * 100 : 0;
    current += size;
    return `${chartColors[index % chartColors.length]} ${start}% ${current}%`;
  }).join(', ') : '#1f2933 0 100%';
  return <div className="grafana-panel pie-panel">
    <PanelTitle title={title} />
    <div className="pie-layout">
      <div className="pie-chart" style={{background:`conic-gradient(${gradient})`}} />
      <div className="legend-list">
        {rows.map((row,index)=>
          <div className="legend-row" key={`${row.label}-${index}`}>
            <i style={{background:chartColors[index % chartColors.length]}} />
            <span>{row.label}</span>
            <strong>{formatMetricValue(row.value)}</strong>
          </div>
        )}
        {!rows.length && <div className="grafana-empty">No data</div>}
      </div>
    </div>
  </div>;
}

function LinePanel({title,series,unit}){
  return <div className="grafana-panel line-panel">
    <PanelTitle title={title} />
    <svg viewBox="0 0 520 170" preserveAspectRatio="none">
      {[0,1,2,3].map(line=><line key={line} x1="0" x2="520" y1={20 + line*38} y2={20 + line*38} />)}
      {[0,1,2,3,4,5].map(line=><line key={`v-${line}`} y1="10" y2="158" x1={40 + line*86} x2={40 + line*86} />)}
      {series.map((item,index)=>
        <polyline key={`${item.label}-${index}`} points={linePoints(item.values,series)} style={{stroke:chartColors[index % chartColors.length]}} />
      )}
    </svg>
    <div className="chart-legend">
      {series.slice(0,5).map((item,index)=><span key={`${item.label}-${index}`}><i style={{background:chartColors[index % chartColors.length]}} />{item.label}</span>)}
      {!series.length && <span>No {unit} data</span>}
    </div>
  </div>;
}

function BarPanel({title,rows,unit}){
  const max=Math.max(...rows.map(row=>row.value),1);
  return <div className="grafana-panel bar-panel">
    <PanelTitle title={title} />
    <div className="bar-list">
      {rows.map((row,index)=>
        <div className="bar-row" key={`${row.label}-${index}`}>
          <span>{row.label}</span>
          <div><i style={{width:`${Math.max((row.value / max) * 100,3)}%`, background:chartColors[index % chartColors.length]}} /></div>
          <strong>{formatMetricValue(row.value)} {unit}</strong>
        </div>
      )}
      {!rows.length && <div className="grafana-empty">No data</div>}
    </div>
  </div>;
}

function ResourceListPanel({title,rows,empty}){
  return <div className="grafana-panel resource-list-panel">
    <PanelTitle title={title} />
    <div className="resource-list-table">
      {rows.map((row,index)=>
        <div className="resource-list-row" key={`${row.label}-${row.value}-${index}`}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      )}
      {!rows.length && <div className="grafana-empty">{empty}</div>}
    </div>
  </div>;
}

function GaugePanel({title,value,suffix}){
  const clamped=Math.max(0,Math.min(value || 0,100));
  return <div className="grafana-panel gauge-panel">
    <PanelTitle title={title} />
    <div className="gauge" style={{background:`conic-gradient(#73bf69 0 ${clamped * 1.8}deg,#ff9830 ${clamped * 1.8}deg 230deg,#2b323b 230deg 360deg)`}}>
      <div><strong>{formatMetricValue(value)}</strong><span>{suffix}</span></div>
    </div>
  </div>;
}

function PanelTitle({title}){
  return <div className="grafana-panel-title">{title}</div>;
}

const chartColors=['#73bf69','#f2cc0c','#6ed0e0','#ff9830','#f2495c','#b877d9','#5794f2','#e0b400'];

function prometheusRows(response,labels=['instance','pod','namespace','job']){
  return (response?.data?.result || []).map(item=>{
    const metric=item.metric || {};
    return {
      label:metricLabel(metric,labels),
      value:promNumber(item.value?.[1]),
    };
  }).sort((a,b)=>b.value-a.value);
}

function rangeSeries(response,labels=['instance','job']){
  return (response?.data?.result || []).slice(0,8).map(item=>{
    const metric=item.metric || {};
    return {
      label:metricLabel(metric,labels),
      values:(item.values || []).map(value=>promNumber(value[1])),
    };
  });
}

function promNumber(value){
  const number=Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function metricLabel(metric,labels){
  const values=labels.map(labelKey=>metric[labelKey]).filter(Boolean);
  if(values.length) return values.join('/');
  return metric.instance || metric.pod || metric.namespace || metric.job || 'cluster';
}

function linePoints(values,series){
  const allValues=series.flatMap(item=>item.values);
  const max=Math.max(...allValues,1);
  const length=Math.max(values.length-1,1);
  return values.map((value,index)=>{
    const x=(index / length) * 520;
    const y=155 - ((value / max) * 130);
    return `${x},${y}`;
  }).join(' ');
}

function firstPromValue(response){
  return promNumber(response?.data?.result?.[0]?.value?.[1]);
}

function firstPromLabel(response,label){
  return response?.data?.result?.find(item=>item.metric?.[label])?.metric?.[label] || '';
}

function sumRows(rows){
  return rows.reduce((sum,row)=>sum + (Number(row.value) || 0),0);
}

function averageRows(rows){
  if(!rows.length) return 0;
  return sumRows(rows) / rows.length;
}

function maxRows(rows){
  return rows.length ? Math.max(...rows.map(row=>Number(row.value) || 0)) : 0;
}

function combineRows(...rowGroups){
  const totals=new Map();
  rowGroups.flat().forEach(row=>{
    const current=totals.get(row.label) || 0;
    totals.set(row.label,current + (Number(row.value) || 0));
  });
  return Array.from(totals.entries())
    .map(([label,value])=>({label,value}))
    .sort((a,b)=>b.value-a.value);
}

function formatMetricValue(value){
  if(!Number.isFinite(value)) return '0';
  if(value>=100) return String(Math.round(value));
  return value.toFixed(1);
}

function formatBytes(value){
  if(!value) return '-';
  if(value > 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if(value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if(value > 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function TerminalPanel({namespace,podName,onAskFix}){
  const [command,setCommand]=useState(`kubectl get pods -n ${namespace || 'default'}`);
  const [running,setRunning]=useState(false);
  const [history,setHistory]=useState([
    {
      command:'kubectl terminal ready',
      exit_code:0,
      stdout:'Run kubectl get/describe/logs/apply/rollout/scale commands from inside the cluster service account.',
      stderr:'',
    },
  ]);
  const outputRef=useRef(null);
  const quickCommands=[
    `kubectl get pods -n ${namespace || 'default'} -o wide`,
    podName ? `kubectl describe pod ${podName} -n ${namespace || 'default'}` : `kubectl get events -n ${namespace || 'default'} --sort-by=.lastTimestamp`,
    podName ? `kubectl logs ${podName} -n ${namespace || 'default'} --tail=200` : 'kubectl get nodes -o wide',
    `kubectl get events -n ${namespace || 'default'} --sort-by=.lastTimestamp`,
  ];

  useEffect(()=>{
    outputRef.current?.scrollIntoView({behavior:'smooth', block:'end'});
  },[history,running]);

  async function runCommand(){
    const trimmed=command.trim();
    if(!trimmed) return;
    setRunning(true);
    setHistory(current=>[
      ...current,
      {command:trimmed, exit_code:null, stdout:'Running...', stderr:''},
    ]);
    try {
      const response=await fetch(`${API}/kubectl/run`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          command:trimmed,
          stdin:'',
        }),
      });
      const data=await response.json();
      setHistory(current=>[
        ...current.slice(0,-1),
        response.ok ? data : {command:trimmed, exit_code:1, stdout:'', stderr:data.detail || 'kubectl command failed'},
      ]);
    } catch (err) {
      setHistory(current=>[
        ...current.slice(0,-1),
        {command:trimmed, exit_code:1, stdout:'', stderr:`Unable to reach backend: ${err.message}`},
      ]);
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(event){
    if(event.key==='Enter' && !event.shiftKey){
      event.preventDefault();
      runCommand();
    }
  }

  return <section className="terminal-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Cluster terminal</span>
        <h3>Kubectl console</h3>
      </div>
      <span className="selected-pill">{namespace || 'default'} / {podName || 'no pod selected'}</span>
    </div>

    <div className="terminal-body">
      <div className="terminal-output">
        {history.map((item,index)=>
          <div key={`${item.command}-${index}`} className={`terminal-entry ${item.exit_code ? 'failed' : 'ok'}`}>
            <div className="terminal-command">$ {item.command}</div>
            {item.stdout && <pre>{item.stdout}</pre>}
            {item.stderr && <pre className="stderr">{item.stderr}</pre>}
            <div className="terminal-entry-footer">
              {item.exit_code !== null && <small>exit code {item.exit_code}</small>}
              {item.exit_code !== null && item.command !== 'kubectl terminal ready' && <button type="button" onClick={()=>onAskFix(item)}>
                <MessageSquareText size={14}/>
                Fix in chat
              </button>}
            </div>
          </div>
        )}
        <div ref={outputRef} />
      </div>

      <div className="terminal-controls">
        <div className="quick-command-grid">
          {quickCommands.map(item=>
            <button key={item} type="button" onClick={()=>setCommand(item)}>{item}</button>
          )}
        </div>

        <div className="terminal-input-row">
          <textarea
            value={command}
            onChange={event=>setCommand(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="kubectl get pods -A"
          />
          <button onClick={runCommand} disabled={running || !command.trim()} title="Run kubectl command">
            {running ? <Loader2 className="spin" size={19}/> : <Send size={19}/>}
          </button>
        </div>
      </div>
    </div>
  </section>;
}

function EventItem({event}){
  const isWarning=(event.type || '').toLowerCase()==='warning';
  return <div className={`event-item ${isWarning ? 'warning' : 'normal'}`}>
    <div className="event-icon">{isWarning ? <AlertTriangle size={17}/> : <CheckCircle2 size={17}/>}</div>
    <div>
      <div className="event-title">
        <strong>{event.reason}</strong>
        <span>{event.namespace}</span>
      </div>
      <p>{event.message}</p>
      <small>{event.object_kind} / {event.object_name} / count {event.count} / {event.last_timestamp}</small>
    </div>
  </div>;
}

function ChatMessage({message}){
  if(message.role==='user'){
    return <div className="message user">
      <div className="bubble">
        <strong>{message.content.question}</strong>
        <small>{message.content.namespace} / {message.content.pod_name || 'no pod selected'}</small>
      </div>
    </div>;
  }

  const content=message.content || {};
  return <div className="message assistant">
    <div className="avatar"><Sparkles size={18}/></div>
    <div className="bubble">
      {content.error ? <p className="error-text">{content.error}</p> : <>
        <h4>{content.reason || 'Analysis result'}</h4>
        {content.fix && <p>{content.fix}</p>}
        {content.ai_explanation && <RichAnswer text={content.ai_explanation} />}
        {Array.isArray(content.commands) && content.commands.length>0 && <div className="commands">
          {content.commands.map((cmd,i)=><code key={i}>{cmd}</code>)}
        </div>}
        {Array.isArray(content.sources) && content.sources.length>0 && <div className="source-list">
          {content.sources.map(source=>
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
          )}
        </div>}
        {typeof content.confidence !== 'undefined' && <small>Confidence {content.confidence}%</small>}
      </>}
    </div>
  </div>;
}

function RichAnswer({text}){
  const lines=String(text || '').split('\n').filter(line=>line.trim());
  return <div className="rich-answer">
    {lines.map((line,index)=>{
      const trimmed=line.trim();
      if(trimmed.startsWith('### ')){
        return <h5 key={index}>{trimmed.slice(4)}</h5>;
      }
      if(trimmed.startsWith('## ')){
        return <h5 key={index}>{trimmed.slice(3)}</h5>;
      }
      if(trimmed.startsWith('- `') && trimmed.endsWith('`')){
        return <code key={index}>{trimmed.slice(3,-1)}</code>;
      }
      if(trimmed.startsWith('- ')){
        return <p key={index} className="answer-bullet">{trimmed.slice(2)}</p>;
      }
      return <p key={index}>{trimmed}</p>;
    })}
  </div>;
}

function ResourceGraph({pods,services,deployments,selectedPod,selectedNamespace,onSelectPod,onSelectNamespace}){
  const [openNamespace,setOpenNamespace]=useState(selectedNamespace || "");

  const namespaces=useMemo(()=>{
    const names=new Set([
      ...pods.map(item=>item.namespace),
      ...services.map(item=>item.namespace),
      ...deployments.map(item=>item.namespace),
    ].filter(Boolean));
    return Array.from(names).sort((a,b)=>{
      if(a===selectedNamespace) return -1;
      if(b===selectedNamespace) return 1;
      return a.localeCompare(b);
    });
  },[pods,services,deployments,selectedNamespace]);

  useEffect(()=>{
    if(selectedNamespace){
      setOpenNamespace(selectedNamespace);
    }
  },[selectedNamespace]);

  function toggleNamespace(ns){
    setOpenNamespace(current=>current===ns ? "" : ns);
    if(ns!==selectedNamespace){
      onSelectNamespace(ns);
    }
  }

  if(!namespaces.length){
    return <div className="graph compact"><div className="empty">No namespace resources found</div></div>;
  }

  return <div className="graph compact">
    {namespaces.map(ns=>{
      const nsPods=pods.filter(item=>item.namespace===ns);
      const nsServices=services.filter(item=>item.namespace===ns);
      const nsDeployments=deployments.filter(item=>item.namespace===ns);
      const badPods=nsPods.filter(item=>!isPodHealthy(item));
      const badDeployments=nsDeployments.filter(item=>!isDeploymentHealthy(item));
      const hasIssue=badPods.length>0 || badDeployments.length>0;
      const isOpen=openNamespace===ns;

      return <div key={ns} className={`namespace-group ${hasIssue ? 'has-issue' : 'healthy'}`}>
        <button className="namespace-row" type="button" onClick={()=>toggleNamespace(ns)}>
          <span className="arrow">{isOpen ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</span>
          <span className="namespace-icon"><Boxes size={19}/></span>
          <span className="namespace-name">{ns}</span>
          <span className="namespace-count">{nsDeployments.length} deploy</span>
          <span className="namespace-count">{nsServices.length} svc</span>
          <span className="namespace-count">{nsPods.length} pod</span>
          <PhaseBadge phase={hasIssue ? 'Issue' : 'Healthy'} />
        </button>

        {isOpen && <div className="namespace-children">
          <ResourceSection title="Deployments">
            {nsDeployments.map(item=>
              <ResourceNode key={`deploy-${item.namespace}-${item.name}`} icon={<Activity size={18}/>} name={item.name} meta={`${item.ready_replicas}/${item.replicas} ready`} healthy={isDeploymentHealthy(item)} />
            )}
          </ResourceSection>
          <ResourceSection title="Services">
            {nsServices.map(item=>
              <ResourceNode key={`svc-${item.namespace}-${item.name}`} icon={<Network size={18}/>} name={item.name} meta={`${item.type}${item.ports?.length ? ` : ${item.ports.map(port=>port.port).join(', ')}` : ''}`} healthy />
            )}
          </ResourceSection>
          <ResourceSection title="Pods">
            {nsPods.map(item=>
              <ResourceNode
                key={`pod-${item.namespace}-${item.name}`}
                icon={item.name.includes('postgres') || item.name.includes('redis') ? <Database size={18}/> : <Terminal size={18}/>}
                name={item.name}
                meta={`${item.phase || 'Unknown'} / ${item.restarts} restarts`}
                healthy={isPodHealthy(item)}
                active={selectedPod?.namespace===item.namespace && selectedPod?.name===item.name}
                onClick={()=>onSelectPod(item)}
              />
            )}
          </ResourceSection>
        </div>}
      </div>;
    })}
  </div>;
}

function ResourceSection({title,children}){
  const count=React.Children.count(children);
  return <div className="resource-section">
    <span>{title}</span>
    {count ? children : <div className="resource-empty">No {title.toLowerCase()}</div>}
  </div>;
}

function ResourceNode({icon,name,meta,healthy,active,onClick}){
  return <button
    className={`resource-node ${healthy ? 'healthy' : 'has-issue'} ${active ? 'active' : ''}`}
    onClick={onClick}
    type="button"
    disabled={!onClick}
  >
    <div className="resource-icon">{icon}</div>
    <div>
      <strong>{name}</strong>
      <small>{meta}</small>
    </div>
    <span className="resource-state">{healthy ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</span>
  </button>;
}

function isPodHealthy(pod){
  return pod.phase==='Running' || pod.phase==='Succeeded';
}

function isDeploymentHealthy(deployment){
  return (deployment.replicas || 0)===(deployment.ready_replicas || 0);
}

function PhaseBadge({phase}){
  const ok=phase==='Running' || phase==='Succeeded' || phase==='Healthy';
  return <span className={`phase ${ok ? 'ok' : 'bad'}`}>{phase || 'Unknown'}</span>;
}

createRoot(document.getElementById('root')).render(<App/>);
