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
