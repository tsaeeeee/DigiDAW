class Ditune2WasmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'referenceHz', defaultValue: 440, minValue: 415, maxValue: 466, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 75, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'humanize', defaultValue: 20, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'transition', defaultValue: 30, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'color', defaultValue: 50, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'modeHQ', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.exports = null;
    this.memoryF32 = null;
    this.ptrs = null;
    this.telemetryDivider = 0;
    const bytes = options?.processorOptions?.wasmBytes;
    if (!bytes) {
      this.port.postMessage({ type: 'error', message: 'Ditune2 processor received no WASM payload.' });
      return;
    }
    const env = { exp: Math.exp, log: Math.log, cos: Math.cos, sqrt: Math.sqrt };
    WebAssembly.instantiate(bytes, { env }).then(({ instance }) => {
      this.exports = instance.exports;
      this.exports.ditune2_init(sampleRate);
      this.memoryF32 = new Float32Array(this.exports.memory.buffer);
      this.ptrs = {
        inL: this.exports.ditune2_in_l_ptr() >>> 2,
        inR: this.exports.ditune2_in_r_ptr() >>> 2,
        outL: this.exports.ditune2_out_l_ptr() >>> 2,
        outR: this.exports.ditune2_out_r_ptr() >>> 2,
      };
      this.port.postMessage({ type: 'ready' });
    }).catch((error) => this.port.postMessage({ type: 'error', message: String(error?.message || error) }));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 128;
    const inL = input[0];
    const inR = input[1] || input[0];

    if (!this.exports || !this.memoryF32 || !this.ptrs) {
      for (let ch = 0; ch < output.length; ch++) {
        const src = input[ch] || input[0];
        const dst = output[ch];
        for (let i = 0; i < frames; i++) dst[i] = src ? src[i] : 0;
      }
      return true;
    }

    const value = (name) => {
      const a = parameters[name];
      return a && a.length ? a[a.length - 1] : 0;
    };
    this.exports.ditune2_set_params(value('referenceHz'), value('speed'), value('humanize'), value('transition'), value('color'), value('modeHQ'));

    for (let i = 0; i < frames; i++) {
      this.memoryF32[this.ptrs.inL + i] = inL ? inL[i] : 0;
      this.memoryF32[this.ptrs.inR + i] = inR ? inR[i] : (inL ? inL[i] : 0);
    }
    this.exports.ditune2_process(frames);
    for (let ch = 0; ch < output.length; ch++) {
      const srcPtr = ch === 0 ? this.ptrs.outL : this.ptrs.outR;
      const dst = output[ch];
      for (let i = 0; i < frames; i++) dst[i] = this.memoryF32[srcPtr + i];
    }

    if (++this.telemetryDivider >= 8) {
      this.telemetryDivider = 0;
      this.port.postMessage({
        type: 'telemetry',
        detectedHz: this.exports.ditune2_detected_hz(),
        targetHz: this.exports.ditune2_target_hz(),
        confidence: this.exports.ditune2_confidence(),
        centsDeviation: this.exports.ditune2_cents(),
        correctionCents: this.exports.ditune2_correction_cents(),
        targetMidi: this.exports.ditune2_target_midi(),
        isTracking: this.exports.ditune2_tracking() >= 0.5,
        inputRms: this.exports.ditune2_input_rms ? this.exports.ditune2_input_rms() : 0,
        detectorQuality: this.exports.ditune2_detector_quality ? this.exports.ditune2_detector_quality() : 0,
        analysisReady: this.exports.ditune2_analysis_ready ? this.exports.ditune2_analysis_ready() >= 0.5 : false,
        voicedHoldMs: this.exports.ditune2_voiced_hold_ms ? this.exports.ditune2_voiced_hold_ms() : 0,
      });
    }
    return true;
  }
}

registerProcessor('ditune2-wasm-v1', Ditune2WasmProcessor);