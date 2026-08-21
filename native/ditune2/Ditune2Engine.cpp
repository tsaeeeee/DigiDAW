#include "Ditune2Engine.h"

#if defined(DITUNE2_WASM)
extern "C" double js_exp(double) __attribute__((import_module("env"), import_name("exp")));
extern "C" double js_log(double) __attribute__((import_module("env"), import_name("log")));
extern "C" double js_cos(double) __attribute__((import_module("env"), import_name("cos")));
extern "C" double js_sqrt(double) __attribute__((import_module("env"), import_name("sqrt")));
#else
#include <cmath>
#endif

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kLn2 = 0.69314718055994530942;
constexpr double kLn10 = 2.30258509299404568402;

inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline float absf(float x) { return x < 0.0f ? -x : x; }
inline float maxf(float a, float b) { return a > b ? a : b; }
inline float minf(float a, float b) { return a < b ? a : b; }
inline float expf_fast(float x) {
#if defined(DITUNE2_WASM)
    return static_cast<float>(js_exp(static_cast<double>(x)));
#else
    return std::exp(x);
#endif
}
inline float logf_fast(float x) {
    const float safe = maxf(x, 1.0e-12f);
#if defined(DITUNE2_WASM)
    return static_cast<float>(js_log(static_cast<double>(safe)));
#else
    return std::log(safe);
#endif
}
inline float cosf_fast(float x) {
#if defined(DITUNE2_WASM)
    return static_cast<float>(js_cos(static_cast<double>(x)));
#else
    return std::cos(x);
#endif
}
inline float sqrtf_fast(float x) {
    const float safe = maxf(x, 0.0f);
#if defined(DITUNE2_WASM)
    return static_cast<float>(js_sqrt(static_cast<double>(safe)));
#else
    return std::sqrt(safe);
#endif
}
inline float semitonesToRatio(float semis) { return expf_fast(semis * static_cast<float>(kLn2 / 12.0)); }
inline float hzToMidi(float hz, float referenceHz) { return 69.0f + 12.0f * logf_fast(hz / referenceHz) / static_cast<float>(kLn2); }
inline float midiToHz(float midi, float referenceHz) { return referenceHz * expf_fast((midi - 69.0f) * static_cast<float>(kLn2 / 12.0)); }
inline int roundi(float x) { return x >= 0.0f ? static_cast<int>(x + 0.5f) : static_cast<int>(x - 0.5f); }
inline float smoothCoeff(float seconds, float sampleRate) {
    const float safe = maxf(seconds, 1.0e-5f);
    return expf_fast(-1.0f / (safe * sampleRate));
}
inline float wrapRing(float x) {
    while (x < 0.0f) x += static_cast<float>(Ditune2Engine::kRingSize);
    while (x >= static_cast<float>(Ditune2Engine::kRingSize)) x -= static_cast<float>(Ditune2Engine::kRingSize);
    return x;
}
}

void Ditune2Engine::init(float sampleRate) {
    sampleRate_ = clampf(sampleRate, 8000.0f, 192000.0f);
    referenceHz_ = 440.0f;
    speed_ = 75.0f;
    humanize_ = 20.0f;
    transition_ = 30.0f;
    color_ = 50.0f;
    modeHQ_ = 0.0f;
    reset();
}

void Ditune2Engine::reset() {
    writeIndex_ = 0;
    framesWritten_ = 0;
    analysisWrite_ = 0;
    analysisCount_ = 0;
    downsamplePhase_ = 0;
    samplesSincePitch_ = 0;
    detectedHz_ = 0.0f;
    targetHz_ = 0.0f;
    confidence_ = 0.0f;
    centsDeviation_ = 0.0f;
    targetMidi_ = 0.0f;
    tracking_ = false;
    voicedNow_ = false;
    unvoicedSamples_ = 0;
    lastStableHz_ = 0.0f;
    octaveCandidateHz_ = 0.0f;
    octaveCandidateFrames_ = 0;
    measuredMidiFast_ = measuredMidiCenter_ = 0.0f;
    haveMidi_ = false;
    currentTargetNote_ = candidateTargetNote_ = candidateFrames_ = 0;
    targetGuideMidi_ = 0.0f;
    correctionSemitones_ = 0.0f;
    shifterPhase_ = 0.0f;
    periodSamples_ = 240.0f;
    windowSamples_ = smoothedWindow_ = 960.0f;
    smoothedRatio_ = 1.0f;
    colorLowL_ = colorLowR_ = 0.0f;
    for (int i = 0; i < kRingSize; ++i) { ringL_[i] = 0.0f; ringR_[i] = 0.0f; }
    for (int i = 0; i < kAnalysisSize; ++i) analysis_[i] = 0.0f;
}

void Ditune2Engine::setParams(float referenceHz, float speed, float humanize, float transition, float color, float modeHQ) {
    referenceHz_ = clampf(referenceHz, 415.0f, 466.0f);
    speed_ = clampf(speed, 0.0f, 100.0f);
    humanize_ = clampf(humanize, 0.0f, 100.0f);
    transition_ = clampf(transition, 0.0f, 100.0f);
    color_ = clampf(color, 0.0f, 100.0f);
    modeHQ_ = modeHQ >= 0.5f ? 1.0f : 0.0f;
}

void Ditune2Engine::pushAnalysis(float mono) {
    if (++downsamplePhase_ < 4) return;
    downsamplePhase_ = 0;
    analysis_[analysisWrite_] = mono;
    analysisWrite_ = (analysisWrite_ + 1) % kAnalysisSize;
    if (analysisCount_ < kAnalysisSize) ++analysisCount_;
}

void Ditune2Engine::analysePitch() {
    if (analysisCount_ < 640) return;

    constexpr int kWork = 768;
    float x[kWork];
    const int start = (analysisWrite_ - kWork + kAnalysisSize) % kAnalysisSize;
    float mean = 0.0f;
    for (int i = 0; i < kWork; ++i) {
        x[i] = analysis_[(start + i) % kAnalysisSize];
        mean += x[i];
    }
    mean /= static_cast<float>(kWork);

    float rms = 0.0f;
    for (int i = 0; i < kWork; ++i) {
        x[i] -= mean;
        rms += x[i] * x[i];
    }
    rms = sqrtf_fast(rms / static_cast<float>(kWork));
    if (rms < 0.0025f) {
        releaseUnvoiced();
        return;
    }

    const float analysisRate = sampleRate_ * 0.25f;
    const int minLag = static_cast<int>(analysisRate / 1050.0f);
    const int maxLag = static_cast<int>(analysisRate / 55.0f);
    const int safeMin = minLag < 2 ? 2 : minLag;
    const int safeMax = maxLag > 220 ? 220 : maxLag;

    float diff[221] = {};
    float cmnd[221] = {};
    float running = 0.0f;
    for (int tau = 1; tau <= safeMax; ++tau) {
        float d = 0.0f;
        const int limit = kWork - tau;
        for (int i = 0; i < limit; ++i) {
            const float delta = x[i] - x[i + tau];
            d += delta * delta;
        }
        diff[tau] = d;
        running += d;
        cmnd[tau] = running > 1.0e-12f ? d * static_cast<float>(tau) / running : 1.0f;
    }

    const float threshold = modeHQ_ > 0.5f ? 0.12f : 0.16f;
    int bestLag = 0;
    float bestCmnd = 1.0e9f;
    for (int tau = safeMin + 1; tau < safeMax - 1; ++tau) {
        const float c = cmnd[tau];
        if (c < threshold && c <= cmnd[tau - 1] && c <= cmnd[tau + 1]) {
            bestLag = tau;
            bestCmnd = c;
            break;
        }
    }
    if (bestLag == 0) {
        for (int tau = safeMin; tau <= safeMax; ++tau) {
            if (cmnd[tau] < bestCmnd) { bestCmnd = cmnd[tau]; bestLag = tau; }
        }
    }
    if (bestLag <= 0 || bestCmnd > 0.34f) {
        releaseUnvoiced();
        return;
    }

    float refinedLag = static_cast<float>(bestLag);
    if (bestLag > safeMin && bestLag < safeMax) {
        const float a = cmnd[bestLag - 1];
        const float b = cmnd[bestLag];
        const float c = cmnd[bestLag + 1];
        const float denom = a - 2.0f * b + c;
        if (absf(denom) > 1.0e-9f) refinedLag += 0.5f * (a - c) / denom;
    }

    const float hz = analysisRate / maxf(refinedLag, 1.0f);
    const float conf = clampf(1.0f - bestCmnd, 0.0f, 1.0f);
    if (hz < 55.0f || hz > 1050.0f || conf < (tracking_ ? 0.52f : 0.60f)) {
        releaseUnvoiced();
        return;
    }

    float acceptedHz = hz;
    if (lastStableHz_ > 0.0f) {
        const float ratio = hz / lastStableHz_;
        const bool octaveLike = (ratio > 1.82f && ratio < 2.18f) || (ratio > 0.46f && ratio < 0.55f);
        if (octaveLike) {
            const float candidateRatio = octaveCandidateHz_ > 0.0f ? hz / octaveCandidateHz_ : 99.0f;
            if (candidateRatio > 0.94f && candidateRatio < 1.06f) ++octaveCandidateFrames_;
            else { octaveCandidateHz_ = hz; octaveCandidateFrames_ = 1; }
            if (octaveCandidateFrames_ < 3) acceptedHz = lastStableHz_;
            else { octaveCandidateFrames_ = 0; octaveCandidateHz_ = 0.0f; }
        } else {
            octaveCandidateFrames_ = 0;
            octaveCandidateHz_ = 0.0f;
        }
    }

    updateController(acceptedHz, conf);
    lastStableHz_ = acceptedHz;
}

void Ditune2Engine::updateController(float hz, float conf) {
    detectedHz_ = hz;
    confidence_ = conf;
    tracking_ = true;
    voicedNow_ = true;
    unvoicedSamples_ = 0;

    const float midi = hzToMidi(hz, referenceHz_);
    if (!haveMidi_) {
        measuredMidiFast_ = measuredMidiCenter_ = midi;
        currentTargetNote_ = roundi(midi);
        candidateTargetNote_ = currentTargetNote_;
        targetGuideMidi_ = static_cast<float>(currentTargetNote_);
        haveMidi_ = true;
    }

    const float fastAlpha = modeHQ_ > 0.5f ? 0.34f : 0.47f;
    measuredMidiFast_ += (midi - measuredMidiFast_) * fastAlpha;
    const float centerAlpha = 0.055f + (humanize_ * 0.00105f);
    measuredMidiCenter_ += (measuredMidiFast_ - measuredMidiCenter_) * centerAlpha;

    int nearest = roundi(measuredMidiCenter_);
    const float distanceFromCurrent = absf(measuredMidiCenter_ - static_cast<float>(currentTargetNote_));
    const float switchBoundary = 0.56f + humanize_ * 0.0008f;
    if (nearest != currentTargetNote_ && distanceFromCurrent > switchBoundary) {
        if (nearest == candidateTargetNote_) ++candidateFrames_;
        else { candidateTargetNote_ = nearest; candidateFrames_ = 1; }
        const int required = conf > 0.84f ? 2 : 3;
        if (candidateFrames_ >= required) {
            currentTargetNote_ = nearest;
            candidateFrames_ = 0;
        }
    } else {
        candidateTargetNote_ = currentTargetNote_;
        candidateFrames_ = 0;
    }

    const float transitionNorm = transition_ * 0.01f;
    const float glideSeconds = 0.004f + transitionNorm * transitionNorm * 0.22f;
    const float hopSeconds = (modeHQ_ > 0.5f ? 768.0f : 512.0f) / sampleRate_;
    const float guideAlpha = 1.0f - expf_fast(-hopSeconds / maxf(glideSeconds, 0.001f));
    targetGuideMidi_ += (static_cast<float>(currentTargetNote_) - targetGuideMidi_) * guideAlpha;

    const float deviation = targetGuideMidi_ - measuredMidiFast_;
    const float human = humanize_ * 0.01f;
    const float deadBand = 0.010f + human * 0.075f;
    float desired = 0.0f;
    if (absf(deviation) > deadBand) {
        const float sign = deviation < 0.0f ? -1.0f : 1.0f;
        const float outside = absf(deviation) - deadBand;
        const float strength = 1.0f - human * 0.62f;
        desired = sign * outside * strength;
    }
    desired = clampf(desired, -1.75f, 1.75f);

    const float speedNorm = speed_ * 0.01f;
    float retuneMs = 3.5f + (1.0f - speedNorm) * (1.0f - speedNorm) * 185.0f;
    retuneMs += human * 55.0f;
    const float servoAlpha = 1.0f - expf_fast(-hopSeconds / maxf(retuneMs * 0.001f, 0.001f));
    correctionSemitones_ += (desired - correctionSemitones_) * servoAlpha;

    targetMidi_ = targetGuideMidi_;
    targetHz_ = midiToHz(targetGuideMidi_, referenceHz_);
    centsDeviation_ = (midi - static_cast<float>(roundi(midi))) * 100.0f;
    periodSamples_ = clampf(sampleRate_ / hz, 40.0f, 900.0f);
    const float cycles = modeHQ_ > 0.5f ? 6.0f : 4.0f;
    windowSamples_ = clampf(periodSamples_ * cycles, 192.0f, 4096.0f);
}

void Ditune2Engine::releaseUnvoiced() {
    voicedNow_ = false;
    const int hop = modeHQ_ > 0.5f ? 768 : 512;
    unvoicedSamples_ += hop;
    const float hold = 0.075f * sampleRate_;
    if (unvoicedSamples_ > hold) {
        const float seconds = static_cast<float>(hop) / sampleRate_;
        const float alpha = 1.0f - expf_fast(-seconds / 0.045f);
        correctionSemitones_ += (0.0f - correctionSemitones_) * alpha;
    }
    if (unvoicedSamples_ > static_cast<int>(0.22f * sampleRate_)) {
        tracking_ = false;
        confidence_ *= 0.6f;
        detectedHz_ = 0.0f;
        targetHz_ = 0.0f;
        haveMidi_ = false;
    }
}

float Ditune2Engine::readCubic(const float* ring, float pos) const {
    pos = wrapRing(pos);
    const int i1 = static_cast<int>(pos);
    const float t = pos - static_cast<float>(i1);
    const int i0 = (i1 - 1 + kRingSize) % kRingSize;
    const int i2 = (i1 + 1) % kRingSize;
    const int i3 = (i1 + 2) % kRingSize;
    const float y0 = ring[i0], y1 = ring[i1], y2 = ring[i2], y3 = ring[i3];
    const float a0 = -0.5f*y0 + 1.5f*y1 - 1.5f*y2 + 0.5f*y3;
    const float a1 = y0 - 2.5f*y1 + 2.0f*y2 - 0.5f*y3;
    const float a2 = -0.5f*y0 + 0.5f*y2;
    return ((a0*t + a1)*t + a2)*t + y1;
}

float Ditune2Engine::processShiftedSample(const float* ring, int) {
    smoothedWindow_ += (windowSamples_ - smoothedWindow_) * 0.0008f;
    smoothedWindow_ = clampf(smoothedWindow_, 192.0f, 4096.0f);
    const float targetRatio = semitonesToRatio(voicedNow_ ? correctionSemitones_ : 0.0f);
    const float ratioAlpha = 1.0f - smoothCoeff(0.0045f, sampleRate_);
    smoothedRatio_ += (targetRatio - smoothedRatio_) * ratioAlpha;

    const float cents = absf(12.0f * logf_fast(maxf(smoothedRatio_, 1.0e-6f)) / static_cast<float>(kLn2) * 100.0f);
    if (cents < 1.25f) {
        float delta = -shifterPhase_;
        if (delta < -0.5f) delta += 1.0f;
        if (delta > 0.5f) delta -= 1.0f;
        shifterPhase_ += delta * 0.0018f;
    } else {
        shifterPhase_ += (1.0f - smoothedRatio_) / smoothedWindow_;
    }
    shifterPhase_ -= static_cast<int>(shifterPhase_);
    if (shifterPhase_ < 0.0f) shifterPhase_ += 1.0f;

    const float phaseA = shifterPhase_;
    float phaseB = phaseA + 0.5f;
    if (phaseB >= 1.0f) phaseB -= 1.0f;
    const float gainA = 0.5f - 0.5f * cosf_fast(static_cast<float>(2.0 * kPi) * phaseA);
    const float gainB = 1.0f - gainA;
    const float baseDelay = smoothedWindow_ * 0.60f + periodSamples_ * 1.5f;
    const float posA = static_cast<float>(writeIndex_) - baseDelay - phaseA * smoothedWindow_;
    const float posB = static_cast<float>(writeIndex_) - baseDelay - phaseB * smoothedWindow_;
    return readCubic(ring, posA) * gainA + readCubic(ring, posB) * gainB;
}

float Ditune2Engine::applyColor(float x, int channel) {
    const float fc = 4800.0f;
    const float a = expf_fast(static_cast<float>(-2.0 * kPi) * fc / sampleRate_);
    float& low = channel == 0 ? colorLowL_ : colorLowR_;
    low = (1.0f - a) * x + a * low;
    const float high = x - low;
    const float tiltDb = (color_ - 50.0f) * 0.05f;
    const float highGain = expf_fast(tiltDb * static_cast<float>(kLn10 / 20.0));
    return low + high * highGain;
}

void Ditune2Engine::process(const float* inL, const float* inR, float* outL, float* outR, int frames) {
    if (frames < 0) frames = 0;
    if (frames > kBlock) frames = kBlock;
    const int pitchHop = modeHQ_ > 0.5f ? 768 : 512;
    for (int i = 0; i < frames; ++i) {
        const float xL = inL ? inL[i] : 0.0f;
        const float xR = inR ? inR[i] : xL;
        ringL_[writeIndex_] = xL;
        ringR_[writeIndex_] = xR;
        if (framesWritten_ < kRingSize) ++framesWritten_;
        pushAnalysis(0.5f * (xL + xR));
        if (++samplesSincePitch_ >= pitchHop) {
            samplesSincePitch_ = 0;
            analysePitch();
        }

        const float requiredHistory = smoothedWindow_ * 1.7f + periodSamples_ * 2.0f + 8.0f;
        float yL = xL, yR = xR;
        if (framesWritten_ > static_cast<int>(requiredHistory)) {
            yL = processShiftedSample(ringL_, 0);
            const float phaseA = shifterPhase_;
            float phaseB = phaseA + 0.5f; if (phaseB >= 1.0f) phaseB -= 1.0f;
            const float gainA = 0.5f - 0.5f * cosf_fast(static_cast<float>(2.0 * kPi) * phaseA);
            const float gainB = 1.0f - gainA;
            const float baseDelay = smoothedWindow_ * 0.60f + periodSamples_ * 1.5f;
            const float posA = static_cast<float>(writeIndex_) - baseDelay - phaseA * smoothedWindow_;
            const float posB = static_cast<float>(writeIndex_) - baseDelay - phaseB * smoothedWindow_;
            yR = readCubic(ringR_, posA) * gainA + readCubic(ringR_, posB) * gainB;
        }
        outL[i] = applyColor(yL, 0);
        outR[i] = applyColor(yR, 1);
        writeIndex_ = (writeIndex_ + 1) % kRingSize;
    }
}
