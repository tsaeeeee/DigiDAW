export interface ReverbParams {
  mode: number;      // 0: Mid, 1: Side
  hcut: number;      // Hz, 1000 - 20000
  lcut: number;      // Hz, 20 - 2000
  predelay: number;  // ms, 0 - 200
  tempoSync: number; // 0 or 1
  size: number;      // %, 10 - 100
  mod: number;       // %, 0 - 100
  diff: number;      // %, 0 - 100
  speed: number;     // Hz, 0.1 - 10.0
  bass: number;      // multiplier, 0.5 - 2.0
  decay: number;     // seconds, 0.2 - 20.0
  cross: number;     // Hz, 100 - 2000
  damp: number;      // Hz, 500 - 18000
  dry: number;       // %, 0 - 100
  er: number;        // %, 0 - 100
  wet: number;       // %, 0 - 100
  sep: number;       // %, -100 - +100
}

export const DEFAULT_REVERB_PARAMS: ReverbParams = {
  mode: 0,
  hcut: 12000,
  lcut: 120,
  predelay: 20,
  tempoSync: 0,
  size: 65,
  mod: 30,
  diff: 80,
  speed: 1.5,
  bass: 1.0,
  decay: 2.5,
  cross: 500,
  damp: 5000,
  dry: 100,
  er: 40,
  wet: 50,
  sep: 0,
};
