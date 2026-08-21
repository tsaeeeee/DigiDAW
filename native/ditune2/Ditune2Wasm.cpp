#include "Ditune2Engine.h"

namespace {
Ditune2Engine gEngine;
float gInL[Ditune2Engine::kBlock];
float gInR[Ditune2Engine::kBlock];
float gOutL[Ditune2Engine::kBlock];
float gOutR[Ditune2Engine::kBlock];
}

extern "C" {
__attribute__((visibility("default"))) void ditune2_init(float sampleRate) { gEngine.init(sampleRate); }
__attribute__((visibility("default"))) void ditune2_reset() { gEngine.reset(); }
__attribute__((visibility("default"))) void ditune2_set_params(float referenceHz, float speed, float humanize, float transition, float color, float modeHQ) { gEngine.setParams(referenceHz, speed, humanize, transition, color, modeHQ); }
__attribute__((visibility("default"))) int ditune2_in_l_ptr() { return reinterpret_cast<int>(gInL); }
__attribute__((visibility("default"))) int ditune2_in_r_ptr() { return reinterpret_cast<int>(gInR); }
__attribute__((visibility("default"))) int ditune2_out_l_ptr() { return reinterpret_cast<int>(gOutL); }
__attribute__((visibility("default"))) int ditune2_out_r_ptr() { return reinterpret_cast<int>(gOutR); }
__attribute__((visibility("default"))) void ditune2_process(int frames) { gEngine.process(gInL, gInR, gOutL, gOutR, frames); }
__attribute__((visibility("default"))) float ditune2_detected_hz() { return gEngine.detectedHz(); }
__attribute__((visibility("default"))) float ditune2_target_hz() { return gEngine.targetHz(); }
__attribute__((visibility("default"))) float ditune2_confidence() { return gEngine.confidence(); }
__attribute__((visibility("default"))) float ditune2_cents() { return gEngine.centsDeviation(); }
__attribute__((visibility("default"))) float ditune2_correction_cents() { return gEngine.correctionCents(); }
__attribute__((visibility("default"))) float ditune2_target_midi() { return gEngine.targetMidi(); }
__attribute__((visibility("default"))) float ditune2_tracking() { return gEngine.isTracking(); }
__attribute__((visibility("default"))) float ditune2_input_rms() { return gEngine.inputRms(); }
__attribute__((visibility("default"))) float ditune2_detector_quality() { return gEngine.detectorQuality(); }
__attribute__((visibility("default"))) float ditune2_analysis_ready() { return gEngine.analysisReady(); }
__attribute__((visibility("default"))) float ditune2_voiced_hold_ms() { return gEngine.voicedHoldMs(); }
}

extern "C" void* memset(void* dest, int value, unsigned long n) {
    unsigned char* p = static_cast<unsigned char*>(dest);
    for (unsigned long i = 0; i < n; ++i) p[i] = static_cast<unsigned char>(value);
    return dest;
}