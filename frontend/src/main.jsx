import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
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
    const o=await fetch(`${API}/cluster/overview`).then(r=>r.ok ? r.json() : {}).catch(()=>({}));
    const p=await fetch(`${API}/cluster/pods`).then(r=>r.ok ? r.json() : []).catch(()=>[]);
    setOverview(o);
    setPods(p);
    setLastRefresh(new Date());
    if(!selectedRef.current.podName && p.length){
      selectedRef.current={namespace:p[0].namespace,podName:p[0].name};
      setNamespace(p[0].namespace);
      setPodName(p[0].name);
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
          <p>ArgoCD style ops chat</p>
        </div>
      </div>

      <nav className="nav">
        <a className="active"><LayoutDashboard size={18}/> Applications</a>
        <a><MessageSquareText size={18}/> AI Troubleshoot</a>
        <a><Network size={18}/> Cluster Graph</a>
        <a><History size={18}/> Events</a>
      </nav>

      <div className="filter-block">
        <span>Resource filters</span>
        <label>
          <Search size={16}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search pods" />
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
              <h3>ArgoCD resource graph</h3>
            </div>
            <span className="time">{lastRefresh ? lastRefresh.toLocaleTimeString() : 'loading'}</span>
          </div>

          <ResourceGraph pods={filteredPods} selectedPod={selectedPod} onSelect={selectPod} />

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

function ResourceGraph({pods,selectedPod,onSelect}){
  const backendPods=pods.filter(p=>p.name.includes('backend'));
  const frontendPods=pods.filter(p=>p.name.includes('frontend'));
  const dataPods=pods.filter(p=>p.name.includes('postgres') || p.name.includes('redis'));
  const otherPods=pods.filter(p=>!backendPods.includes(p) && !frontendPods.includes(p) && !dataPods.includes(p));

  return <div className="graph">
    <div className="app-node">
      <CircleDot size={24}/>
      <div><strong>k8s-ai</strong><span>application</span></div>
    </div>
    <GraphColumn title="Services" items={[
      {name:'k8s-ai-frontend', icon:<Network size={20}/>, phase:'Running'},
      {name:'k8s-ai-backend', icon:<Network size={20}/>, phase:'Running'},
      {name:'k8s-ai-postgres', icon:<Database size={20}/>, phase:'Running'},
      {name:'k8s-ai-redis', icon:<Database size={20}/>, phase:'Running'},
    ]} />
    <GraphColumn title="Pods" items={[...frontendPods,...backendPods,...dataPods,...otherPods].slice(0,8)} selectedPod={selectedPod} onSelect={onSelect} />
  </div>;
}

function GraphColumn({title,items,selectedPod,onSelect}){
  return <div className="graph-column">
    <span>{title}</span>
    {items.map((item,index)=>
      <button
        key={`${item.name}-${index}`}
        className={`resource-node ${selectedPod?.name===item.name ? 'active' : ''}`}
        onClick={()=>onSelect && onSelect(item)}
        type="button"
      >
        <div className="resource-icon">{item.icon || <Terminal size={20}/>}</div>
        <div>
          <strong>{item.name}</strong>
          <PhaseBadge phase={item.phase}/>
        </div>
        <Activity size={16}/>
      </button>
    )}
  </div>;
}

function PhaseBadge({phase}){
  const ok=phase==='Running' || phase==='Succeeded';
  return <span className={`phase ${ok ? 'ok' : 'bad'}`}>{phase || 'Unknown'}</span>;
}

createRoot(document.getElementById('root')).render(<App/>);
