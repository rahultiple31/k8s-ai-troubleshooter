import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AlertTriangle, Server, Activity, Bot} from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || '/api';

function App(){
  const [overview,setOverview]=useState({});
  const [pods,setPods]=useState([]);
  const [question,setQuestion]=useState('Why is my pod pending?');
  const [namespace,setNamespace]=useState('default');
  const [podName,setPodName]=useState('');
  const [answer,setAnswer]=useState(null);

  async function load(){
    const o=await fetch(`${API}/cluster/overview`).then(r=>r.ok ? r.json() : {}).catch(()=>({}));
    const p=await fetch(`${API}/cluster/pods`).then(r=>r.ok ? r.json() : []).catch(()=>[]);
    setOverview(o); setPods(p);
    if(!podName && p.length){setNamespace(p[0].namespace); setPodName(p[0].name)}
  }
  useEffect(()=>{load(); const t=setInterval(load,15000); return()=>clearInterval(t)},[]);

  async function askAI(){
    setAnswer({loading:true});
    try {
      const res=await fetch(`${API}/ai/troubleshoot`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question, namespace, pod_name:podName})});
      const data=await res.json();
      setAnswer(res.ok ? data : {error:data.detail || 'Troubleshooting request failed'});
    } catch (err) {
      setAnswer({error:`Unable to reach backend: ${err.message}`});
    }
  }

  return <div className="page">
    <header><div><h1>Kubernetes AI Troubleshooter</h1><p>AI support engineer for clusters, nodes, pods, logs, metrics, and events.</p></div><Bot size={42}/></header>
    <section className="cards">
      <Card icon={<Server/>} title="Nodes" value={overview.nodes ?? '-'} />
      <Card icon={<Activity/>} title="Pods" value={overview.pods ?? '-'} />
      <Card icon={<AlertTriangle/>} title="Unhealthy Pods" value={overview.unhealthy_pods ?? '-'} />
      <Card icon={<AlertTriangle/>} title="Not Ready Nodes" value={(overview.not_ready_nodes||[]).length ?? '-'} />
    </section>
    <main>
      <section className="panel">
        <h2>AI Chat Troubleshooting</h2>
        <label>Question</label><input value={question} onChange={e=>setQuestion(e.target.value)} />
        <div className="grid2"><div><label>Namespace</label><input value={namespace} onChange={e=>setNamespace(e.target.value)} /></div><div><label>Pod Name</label><input value={podName} onChange={e=>setPodName(e.target.value)} /></div></div>
        <button onClick={askAI}>Analyze Issue</button>
        {answer && <pre className="answer">{answer.loading?'Analyzing...':JSON.stringify(answer,null,2)}</pre>}
      </section>
      <section className="panel">
        <h2>Pod Health</h2>
        <table><thead><tr><th>Namespace</th><th>Pod</th><th>Phase</th><th>Restarts</th><th>Node</th></tr></thead><tbody>{pods.map((p,i)=><tr key={i} onClick={()=>{setNamespace(p.namespace);setPodName(p.name)}}><td>{p.namespace}</td><td>{p.name}</td><td><span className={p.phase==='Running'?'ok':'bad'}>{p.phase}</span></td><td>{p.restarts}</td><td>{p.node}</td></tr>)}</tbody></table>
      </section>
    </main>
  </div>
}
function Card({icon,title,value}){return <div className="card">{icon}<p>{title}</p><h2>{value}</h2></div>}
createRoot(document.getElementById('root')).render(<App/>);
