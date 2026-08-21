# Ditune2 — shared C++ core + JUCE native wrapper

Ditune2 is an isolated second autotune engine. Existing Ditune and every other DigiDAW plugin remain unchanged.

## Architecture

The vocal DSP lives in `Ditune2Engine.*` and is shared by two hosts:

- **DigiDAW browser:** the engine is compiled to `public/dsp/ditune2-core.wasm` and executed from an `AudioWorklet`.
- **Native plugin:** `PluginProcessor.*` wraps the same engine in a real JUCE `AudioProcessor`; CMake can build VST3/AU/Standalone.

This separation is intentional. JUCE's normal audio-plugin client is a desktop/mobile plugin framework rather than DigiDAW's Web Audio host. The browser therefore uses the same C++ processing code through WebAssembly rather than forcing the entire JUCE application/plugin layer into an AudioWorklet.

## DSP prototype

Ditune2 v0.1 includes:

- in-core YIN-style F0 estimation at Fs/4 with parabolic lag refinement;
- confidence gating and voiced/unvoiced handling;
- octave-change confirmation and chromatic target-note hysteresis;
- separate target glide (`Transition`) and correction servo (`Speed`);
- humanized deadband and reduced correction depth;
- correction limited to +/-1.75 semitones;
- pitch-synchronous overlap-add window length derived from the detected vocal period;
- zero-correction phase parking so an in-tune region collapses to one delayed tap instead of two combing taps;
- unvoiced/consonant regions steer the pitch ratio back to unity instead of continuing to tune the detector hold state;
- shared L/R read-head phase to preserve stereo;
- subtle Color tilt only.

This is intentionally a new A/B engine, not a replacement for Ditune v1 yet. It is closer to vocal-specific pitch-synchronous resynthesis, but it is not claimed to be Antares/Melodyne quality and does not yet perform explicit spectral-envelope/formant estimation.

## Browser WASM build

```bash
clang++ --target=wasm32 -DDITUNE2_WASM=1 -O3 -nostdlib -fno-exceptions -fno-rtti \
  Ditune2Engine.cpp Ditune2Wasm.cpp \
  -Wl,--no-entry -Wl,--export-memory \
  -Wl,--initial-memory=2097152 -Wl,--max-memory=2097152 \
  -Wl,--export=ditune2_init -Wl,--export=ditune2_reset \
  -Wl,--export=ditune2_set_params \
  -Wl,--export=ditune2_in_l_ptr -Wl,--export=ditune2_in_r_ptr \
  -Wl,--export=ditune2_out_l_ptr -Wl,--export=ditune2_out_r_ptr \
  -Wl,--export=ditune2_process \
  -Wl,--export=ditune2_detected_hz -Wl,--export=ditune2_target_hz \
  -Wl,--export=ditune2_confidence -Wl,--export=ditune2_cents \
  -Wl,--export=ditune2_correction_cents -Wl,--export=ditune2_target_midi \
  -Wl,--export=ditune2_tracking -Wl,--allow-undefined \
  -o ../../public/dsp/ditune2-core.wasm
```

## JUCE license

JUCE 9 is separately licensed by its publisher, including AGPL/commercial options. Check the applicable JUCE licence before distributing a proprietary native Ditune2 build.
