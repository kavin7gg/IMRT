// server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==== SARSA simulation parameters (configurable) ====
let NUM_EPISODES = 100;
let STEPS_PER_EPISODE = 100;
let ALPHA = 0.1;
let GAMMA = 0.9;
let EPSILON = 0.2;
const STATE_SIZE = 100;
const ACTION_SIZE = 3; // e.g. decrease / hold / increase

// Q-table
let Q = Array.from({ length: STATE_SIZE }, () =>
  Array.from({ length: ACTION_SIZE }, () => 0)
);

// Runtime variables
let running = false;
let currentEpisode = 0;
let stepInEpisode = 0;
let totalReward = 0;
let rewards = []; // average reward per episode
let state = 0;
let action = 1;
let timer = null;

// Utility: clamp
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Environment (similar to your Java demo but in JS)
class Environment {
  constructor() {
    this.targetDose = 70.0;
    this.oarLimit = 26.0;
    this.state = 30 + Math.random() * 40;
  }
  reset() {
    this.state = 30 + Math.random() * 40;
    return this.state;
  }
  step(action) {
    // action: 0(decrease),1(hold),2(increase)
    const delta = (action - 1) * Math.random() * 5;
    this.state = clamp(this.state + delta, 0, 100);
    const targetError = Math.abs(this.targetDose - this.state);
    const oarPenalty = Math.max(0, (this.state - this.oarLimit) / 10);
    const reward = -targetError - oarPenalty;
    return { nextState: this.state, reward };
  }
}

let env = new Environment();

function resetSimulation() {
  Q = Array.from({ length: STATE_SIZE }, () =>
    Array.from({ length: ACTION_SIZE }, () => 0)
  );
  running = false;
  currentEpisode = 0;
  stepInEpisode = 0;
  totalReward = 0;
  rewards = [];
  env = new Environment();
  state = env.reset();
  action = chooseAction(state);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function chooseAction(st) {
  const s = Math.floor(clamp(st, 0, STATE_SIZE - 1));
  if (Math.random() < EPSILON) return Math.floor(Math.random() * ACTION_SIZE);
  const arr = Q[s];
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function argMax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function sarsaStep() {
  if (currentEpisode >= NUM_EPISODES) {
    stopSimulation();
    io.emit("trainingComplete", { currentEpisode, rewards });
    return;
  }
  const result = env.step(action);
  const nextState = result.nextState;
  const reward = result.reward;
  const nextAction = chooseAction(nextState);

  // indices
  const s = Math.floor(clamp(state, 0, STATE_SIZE - 1));
  const nextS = Math.floor(clamp(nextState, 0, STATE_SIZE - 1));

  Q[s][action] += ALPHA * (reward + GAMMA * Q[nextS][nextAction] - Q[s][action]);

  state = nextState;
  action = nextAction;
  totalReward += reward;
  stepInEpisode++;

  if (stepInEpisode >= STEPS_PER_EPISODE) {
    const avgReward = totalReward / STEPS_PER_EPISODE;
    rewards.push(avgReward);
    currentEpisode++;
    totalReward = 0;
    stepInEpisode = 0;
    // Periodic log emit
    if (currentEpisode % 5 === 0 || currentEpisode === NUM_EPISODES) {
      io.emit("episodeLog", {
        episode: currentEpisode,
        avgReward: avgReward.toFixed(3)
      });
    }
  }

  // Emit periodic update for front-end (every step)
  io.emit("update", {
    state,
    action,
    currentEpisode,
    stepInEpisode,
    rewards,
    qSample: Q[Math.floor(clamp(state, 0, STATE_SIZE - 1))] // lightweight
  });
}

function startSimulation() {
  if (running) return;
  running = true;
  // choose initial
  if (!state) state = env.reset();
  if (!action && action !== 0) action = chooseAction(state);

  // run at ~20 steps/sec (50ms). Client may set different speed later by controlling server.
  timer = setInterval(() => {
    sarsaStep();
  }, 50);
}

function stopSimulation() {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// HTTP routes for quick control or to fetch snapshot
app.get("/status", (req, res) => {
  res.json({
    running,
    currentEpisode,
    stepInEpisode,
    state,
    action,
    rewardsLength: rewards.length
  });
});

app.post("/config", (req, res) => {
  const body = req.body || {};
  if (typeof body.NUM_EPISODES === "number") NUM_EPISODES = body.NUM_EPISODES;
  if (typeof body.STEPS_PER_EPISODE === "number")
    STEPS_PER_EPISODE = body.STEPS_PER_EPISODE;
  if (typeof body.ALPHA === "number") ALPHA = body.ALPHA;
  if (typeof body.GAMMA === "number") GAMMA = body.GAMMA;
  if (typeof body.EPSILON === "number") EPSILON = body.EPSILON;
  res.json({ ok: true });
});

// socket.io control
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  // send initial snapshot
  socket.emit("init", {
    NUM_EPISODES,
    STEPS_PER_EPISODE,
    ALPHA,
    GAMMA,
    EPSILON,
    currentEpisode,
    rewards
  });

  socket.on("start", () => {
    startSimulation();
    io.emit("started");
  });
  socket.on("pause", () => {
    stopSimulation();
    io.emit("paused");
  });
  socket.on("reset", () => {
    resetSimulation();
    io.emit("resetComplete", {
      currentEpisode,
      rewards,
      state
    });
  });
  socket.on("setParams", (params) => {
    if (typeof params.ALPHA === "number") ALPHA = params.ALPHA;
    if (typeof params.GAMMA === "number") GAMMA = params.GAMMA;
    if (typeof params.EPSILON === "number") EPSILON = params.EPSILON;
    if (typeof params.NUM_EPISODES === "number")
      NUM_EPISODES = params.NUM_EPISODES;
    if (typeof params.STEPS_PER_EPISODE === "number")
      STEPS_PER_EPISODE = params.STEPS_PER_EPISODE;
    // immediately ack and send updated snapshot
    socket.emit("paramsUpdated", { ALPHA, GAMMA, EPSILON, NUM_EPISODES, STEPS_PER_EPISODE });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// start server and initialize
resetSimulation();
server.listen(PORT, () => {
  console.log(`AutoPlanner SARSA server listening on :${PORT}`);
});
