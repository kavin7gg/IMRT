import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import Controls from "./components/Controls";
import RewardChart from "./components/RewardChart";
import LogPanel from "./components/LogPanel";
import { actionLabel } from "./lib/sarsaClient";

// Change this if server is on another host
const SERVER_URL = "http://localhost:4000";

export default function App() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [params, setParams] = useState({
    ALPHA: 0.1,
    GAMMA: 0.9,
    EPSILON: 0.2,
    NUM_EPISODES: 100,
    STEPS_PER_EPISODE: 100
  });
  const [rewards, setRewards] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stateInfo, setStateInfo] = useState({ state: null, action: null, currentEpisode: 0 });

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      pushLog(`Connected (${socket.id})`);
    });

    socket.on("init", (data) => {
      setParams(prev => ({...prev, ...data}));
      pushLog("Server initialized with params");
    });

    socket.on("update", (payload) => {
      if (payload.rewards) setRewards([...payload.rewards]);
      setStateInfo({
        state: payload.state,
        action: payload.action,
        currentEpisode: payload.currentEpisode
      });
    });

    socket.on("episodeLog", (pl) => {
      pushLog(`Episode ${pl.episode} → Avg Reward: ${pl.avgReward}`);
    });

    socket.on("trainingComplete", (pl) => {
      pushLog(`✅ Training complete - episodes: ${pl.currentEpisode}`);
      if (pl.rewards) setRewards([...pl.rewards]);
    });

    socket.on("resetComplete", (pl) => {
      pushLog("Reset complete");
      setRewards([]);
      setStateInfo({state: pl.state, action: null, currentEpisode: 0})
    });

    socket.on("paramsUpdated", (p) => {
      setParams(prev => ({...prev, ...p}));
      pushLog("Params updated on server");
    });

    socket.on("disconnect", () => {
      setConnected(false);
      pushLog("Disconnected from server");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // push log helper
  function pushLog(msg) {
    setLogs(l => [...l, `${new Date().toLocaleTimeString()} — ${msg}`].slice(-500));
  }

  // controls
  const onStart = () => {
    // send params to server before starting
    socketRef.current.emit("setParams", params);
    socketRef.current.emit("start");
    pushLog("Start requested");
  };
  const onPause = () => {
    socketRef.current.emit("pause");
    pushLog("Pause requested");
  };
  const onReset = () => {
    socketRef.current.emit("reset");
    pushLog("Reset requested");
  };

  // whenever local params change, send to server (debounced would be ideal)
  useEffect(() => {
    if (!socketRef.current) return;
    // send small delay to avoid flooding UI interactions - but we won't block here
    socketRef.current.emit("setParams", params);
  }, [params]);

  return (
    <div className="app">
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        <Controls socket={socketRef.current} params={params} setParams={setParams} onStart={onStart} onPause={onPause} onReset={onReset} />
        <div className="panel card" style={{width:300}}>
          <div style={{fontFamily:'Orbitron, sans-serif', color:'#9befff'}}>Status</div>
          <div style={{marginTop:8}}>
            <div className="small-muted">Connected: <span style={{color:connected? '#8affc1':'#ff6b8a'}}>{String(connected)}</span></div>
            <div className="small-muted">Episode: <span style={{color:'#bfefff'}}>{stateInfo.currentEpisode}</span></div>
            <div className="small-muted">State: <span style={{color:'#bfefff'}}>{stateInfo.state?.toFixed?.(2) ?? '-'}</span></div>
            <div className="small-muted">Action: <span style={{color:'#bfefff'}}>{actionLabel(stateInfo.action)}</span></div>
          </div>
        </div>
      </div>

      <div className="center">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{fontFamily:'Orbitron, sans-serif', fontSize:22, color:'#7efcff'}}>AutoPlanner RL — Neon Lab</div>
          <div className="small-muted">Live SARSA Visualization</div>
        </div>

        <RewardChart rewards={rewards} />

        <div style={{display:'flex', gap:16}}>
          <div className="card" style={{flex:1, padding:12}}>
            <div style={{fontFamily:'Orbitron, sans-serif', color:'#ffd6ff'}}>Agent Snapshot</div>
            <div style={{marginTop:8, fontSize:13, color:'#cfeff6'}}>
              <div>Current State: {stateInfo.state ? stateInfo.state.toFixed(3) : '-'}</div>
              <div>Current Action: {actionLabel(stateInfo.action)}</div>
              <div>Episodes completed: {stateInfo.currentEpisode}</div>
            </div>
            <div style={{marginTop:12}} className="small-muted">
              Q-table sample (state row) shown below:
            </div>
            <pre style={{marginTop:8, background:'#02121a', padding:10, borderRadius:8, color:'#9befff', fontSize:12}}>
              {/* sample Q row */}
              {JSON.stringify(rewards.length ? "See chart for rewards" : "Waiting...", null, 2)}
            </pre>
          </div>

          <LogPanel logs={logs} />
        </div>
      </div>
    </div>
  );
}
