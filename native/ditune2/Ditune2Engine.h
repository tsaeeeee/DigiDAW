#pragma once

class Ditune2Engine {
public:
    static constexpr int kBlock = 128;
    static constexpr int kRingSize = 65536;
    static constexpr int kAnalysisSize = 2048;

    void init(float sampleRate);
    void reset();
    void setParams(float referenceHz, float speed, float humanize, float transition, float color, float modeHQ);
    void process(const float* inL, const float* inR, float* outL, float* outR, int frames);

    float detectedHz() const { return detectedHz_; }
    float targetHz() const { return targetHz_; }
    float confidence() const { return confidence_; }
    float centsDeviation() const { return centsDeviation_; }
    float correctionCents() const { return correctionSemitones_ * 100.0f; }
    float targetMidi() const { return targetMidi_; }
    float isTracking() const { return tracking_ ? 1.0f : 0.0f; }
    float inputRms() const { return inputRms_; }
    float detectorQuality() const { return detectorQuality_; }
    float analysisReady() const { return analysisReady_ ? 1.0f : 0.0f; }
    float voicedHoldMs() const { return voicedHoldMs_; }

private:
    float sampleRate_ = 48000.0f;
    float referenceHz_ = 440.0f;
    float speed_ = 75.0f;
    float humanize_ = 20.0f;
    float transition_ = 30.0f;
    float color_ = 50.0f;
    float modeHQ_ = 0.0f;

    float ringL_[kRingSize] = {};
    float ringR_[kRingSize] = {};
    int writeIndex_ = 0;
    int framesWritten_ = 0;

    float analysis_[kAnalysisSize] = {};
    int analysisWrite_ = 0;
    int analysisCount_ = 0;
    int downsampleCount_ = 0;
    float downsampleAccum_ = 0.0f;
    int samplesSincePitch_ = 0;

    float detectedHz_ = 0.0f;
    float targetHz_ = 0.0f;
    float confidence_ = 0.0f;
    float centsDeviation_ = 0.0f;
    float targetMidi_ = 0.0f;
    bool tracking_ = false;
    int samplesSinceVoiced_ = 1000000;
    float lastStableHz_ = 0.0f;
    float octaveCandidateHz_ = 0.0f;
    int octaveCandidateFrames_ = 0;

    float measuredMidiFast_ = 0.0f;
    float measuredMidiCenter_ = 0.0f;
    bool haveMidi_ = false;
    int currentTargetNote_ = 0;
    int candidateTargetNote_ = 0;
    int candidateFrames_ = 0;
    float targetGuideMidi_ = 0.0f;
    float correctionSemitones_ = 0.0f;

    float shifterPhase_ = 0.0f;
    float periodSamples_ = 240.0f;
    float windowSamples_ = 960.0f;
    float smoothedWindow_ = 960.0f;
    float smoothedRatio_ = 1.0f;

    float colorLowL_ = 0.0f;
    float colorLowR_ = 0.0f;

    float inputRms_ = 0.0f;
    float detectorQuality_ = 0.0f;
    bool analysisReady_ = false;
    float voicedHoldMs_ = 0.0f;

    void pushAnalysis(float mono);
    void analysePitch();
    void acceptPitch(float hz, float confidence);
    void rejectPitch(float observedConfidence);
    void updateController(float hz, float confidence);
    float readCubic(const float* ring, float pos) const;
    float processShiftedSample(const float* ring);
    float applyColor(float x, int channel);
};