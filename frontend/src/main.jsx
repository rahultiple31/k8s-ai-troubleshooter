import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
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

function App(){
  const [overview,setOverview]=useState({});
  const [pods,setPods]=useState([]);
  const [services,setServices]=useState([]);
  const [deployments,setDeployments]=useState([]);
  const [question,setQuestion]=useState('Why is this pod unhealthy?');
  const [namespace,setNamespace]=useState('default');
  const [podName,setPodName]=useState('');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [lastRefresh,setLastRefresh]=useState(null);
  const selectedRef=useRef({namespace:'default',podName:''});
  const [messages,setMessages]=useState([
    {
      role:'assistant',
      content:{
        reason:'Select a pod and ask a Kubernetes question.',
        fix:'I will inspect pod status, events, logs, nodes, and PVCs from the backend.',
        commands:['kubectl get pods -A','kubectl get events -A --sort-by=.lastTimestamp'],
        confidence:100,
      },
    },
  ]);

  async function load(){
    const [o,p,s,d]=await Promise.all([
      fetch(`${API}/cluster/overview`).then(r=>r.ok ? r.json() : {}).catch(()=>({})),
      fetch(`${API}/cluster/pods`).then(r=>r.ok ? r.json() : []).catch(()=>[]),
      fetch(`${API}/cluster/services`).then(r=>r.ok ? r.json() : []).catch(()=>[]),
      fetch(`${API}/cluster/deployments`).then(r=>r.ok ? r.json() : []).catch(()=>[]),
    ]);
    setOverview(o);
    setPods(p);
    setServices(s);
    setDeployments(d);
    setLastRefresh(new Date());
    if(!selectedRef.current.podName && p.length){
      const preferredPod=p.find(item=>item.namespace===selectedRef.current.namespace) || p[0];
      selectedRef.current={namespace:preferredPod.namespace,podName:preferredPod.name};
      setNamespace(preferredPod.namespace);
      setPodName(preferredPod.name);
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

  const selectedPod=useMemo(
    ()=>pods.find(p=>p.namespace===namespace && p.name===podName),
    [pods,namespace,podName]
  );

  const healthyPods=pods.filter(p=>p.phase==='Running' || p.phase==='Succeeded').length;
  const unhealthyPods=pods.length - healthyPods;
  const syncOk=unhealthyPods===0 && (overview.not_ready_nodes || []).length===0;

  function selectPod(p){
    selectedRef.current={namespace:p.namespace,podName:p.name};
    setNamespace(p.namespace);
    setPodName(p.name);
    setQuestion(`Why is pod ${p.name} in ${p.phase} state?`);
  }

  function selectNamespace(nextNamespace){
    selectedRef.current={namespace:nextNamespace,podName:''};
    setNamespace(nextNamespace);
    setPodName('');
    setQuestion(`Which resources have issues in namespace ${nextNamespace}?`);
  }

  function updateNamespace(value){
    selectedRef.current={...selectedRef.current,namespace:value};
    setNamespace(value);
  }

  function updatePodName(value){
    selectedRef.current={...selectedRef.current,podName:value};
    setPodName(value);
  }

  async function askAI(){
    if(!question.trim()) return;
    const userMessage={role:'user',content:{question,namespace,pod_name:podName}};
    setMessages(current=>[...current,userMessage]);
    setLoading(true);
    try {
      const res=await fetch(`${API}/ai/troubleshoot`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question, namespace, pod_name:podName}),
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
        <a className="active"><LayoutDashboard size={18}/> Applications</a>
        <a><MessageSquareText size={18}/> AI Troubleshoot</a>
        <a><Network size={18}/> Resource Tree</a>
        <a><History size={18}/> Events</a>
      </nav>

      <div className="filter-block">
        <span>Resource filters</span>
        <label>
          <Search size={16}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search resources" />
        </label>
      </div>

      <div className="status-list">
        <StatusRow icon={<CheckCircle2 size={17}/>} label="Synced" value={syncOk ? 1 : 0} tone="good" />
        <StatusRow icon={<AlertTriangle size={17}/>} label="OutOfSync" value={syncOk ? 0 : 1} tone="warn" />
        <StatusRow icon={<ShieldCheck size={17}/>} label="Healthy" value={healthyPods} tone="good" />
        <StatusRow icon={<AlertTriangle size={17}/>} label="Degraded" value={unhealthyPods} tone="bad" />
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div>
          <div className="crumbs">Applications <ChevronRight size={15}/> k8s-ai-troubleshooter</div>
          <h2>Kubernetes AI Troubleshooter</h2>
        </div>
        <button className="icon-button" onClick={load} title="Refresh cluster data">
          <RefreshCw size={18}/>
          Refresh
        </button>
      </header>

      <section className="summary-band">
        <HealthTile label="App Health" value={syncOk ? 'Healthy' : 'Needs attention'} icon={<ShieldCheck/>} tone={syncOk ? 'good' : 'warn'} />
        <HealthTile label="Sync Status" value={syncOk ? 'Synced' : 'Drift detected'} icon={<GitBranch/>} tone={syncOk ? 'good' : 'warn'} />
        <HealthTile label="Nodes" value={overview.nodes ?? '-'} icon={<Server/>} />
        <HealthTile label="Pods" value={overview.pods ?? pods.length ?? '-'} icon={<Boxes/>} />
      </section>

      <section className="content-grid">
        <section className="chat-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AI diagnosis</span>
              <h3>Cluster support chat</h3>
            </div>
            <span className="selected-pill">{namespace || '-'} / {podName || 'select pod'}</span>
          </div>

          <div className="messages">
            {messages.map((msg,index)=>
              <ChatMessage key={`${msg.role}-${index}`} message={msg} />
            )}
            {loading && <div className="message assistant">
              <div className="avatar"><Loader2 className="spin" size={18}/></div>
              <div className="bubble muted">Analyzing pod logs, events, PVCs, and node status...</div>
            </div>}
          </div>

          <div className="composer">
            <div className="target-row">
              <input value={namespace} onChange={e=>updateNamespace(e.target.value)} placeholder="namespace" />
              <input value={podName} onChange={e=>updatePodName(e.target.value)} placeholder="pod name" />
            </div>
            <div className="prompt-row">
              <textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask about pod logs, events, PVC, image pull, CrashLoopBackOff..." />
              <button onClick={askAI} disabled={loading} title="Analyze issue">
                {loading ? <Loader2 className="spin" size={19}/> : <Send size={19}/>}
              </button>
            </div>
          </div>
        </section>

        <section className="ops-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Live resources</span>
              <h3>Resource tree</h3>
            </div>
            <span className="time">{lastRefresh ? lastRefresh.toLocaleTimeString() : 'loading'}</span>
          </div>

          <ResourceGraph
            pods={filteredPods}
            services={filteredServices}
            deployments={filteredDeployments}
            selectedPod={selectedPod}
            selectedNamespace={namespace}
            onSelectPod={selectPod}
            onSelectNamespace={selectNamespace}
          />

          <div className="pod-table-wrap">
            <table>
              <thead>
                <tr><th>Namespace</th><th>Pod</th><th>Phase</th><th>Restarts</th></tr>
              </thead>
              <tbody>
                {filteredPods.map((p,i)=>
                  <tr key={`${p.namespace}-${p.name}-${i}`} onClick={()=>selectPod(p)} className={p.name===podName ? 'selected' : ''}>
                    <td>{p.namespace}</td>
                    <td>{p.name}</td>
                    <td><PhaseBadge phase={p.phase}/></td>
                    <td>{p.restarts}</td>
                  </tr>
                )}
                {!filteredPods.length && <tr><td colSpan="4" className="empty">No pods found</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  </div>;
}

function filterResources(items,search,fields){
  const needle=search.trim().toLowerCase();
  if(!needle) return items;
  return items.filter(item=>
    fields.some(field=>String(item[field] || '').toLowerCase().includes(needle))
  );
}

function StatusRow({icon,label,value,tone}){
  return <div className={`status-row ${tone || ''}`}>
    <span>{icon}{label}</span>
    <strong>{value}</strong>
  </div>;
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
        {content.ai_explanation && <pre>{content.ai_explanation}</pre>}
        {Array.isArray(content.commands) && content.commands.length>0 && <div className="commands">
          {content.commands.map((cmd,i)=><code key={i}>{cmd}</code>)}
        </div>}
        {typeof content.confidence !== 'undefined' && <small>Confidence {content.confidence}%</small>}
      </>}
    </div>
  </div>;
}

function ResourceGraph({pods,services,deployments,selectedPod,selectedNamespace,onSelectPod,onSelectNamespace}){
  const [expanded,setExpanded]=useState({});

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
      setExpanded(current=>({...current,[selectedNamespace]:true}));
    }
  },[selectedNamespace]);

  function toggleNamespace(ns){
    setExpanded(current=>({...current,[ns]:!current[ns]}));
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
      const isOpen=expanded[ns];

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
