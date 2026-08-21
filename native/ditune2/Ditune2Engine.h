#pragma once

class Ditune2Engine {
public:
    static constexpr int kBlock = 128;
    static constexpr int kRingSize = 65536;
    static constexpr int kAnalysisSize = 1024;

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

private:
    float sampleRate_;
    float referenceHz_;
    float speed_;
    float humanize_;
    float transition_;
    float color_;
    float modeHQ_;

    float ringL_[kRingSize];
    float ringR_[kRingSize];
    int writeIndex_;
    int framesWritten_;

    float analysis_[kAnalysisSize];
    int analysisWrite_;
    int analysisCount_;
    int downsamplePhase_;
    int samplesSincePitch_;

    float detectedHz_;
    float targetHz_;
    float confidence_;
    float centsDeviation_;
    float targetMidi_;
    bool tracking_;
    bool voicedNow_;
    int unvoicedSamples_;
    float lastStableHz_;
    float octaveCandidateHz_;
    int octaveCandidateFrames_;

    float measuredMidiFast_;
    float measuredMidiCenter_;
    bool haveMidi_;
    int currentTargetNote_;
    int candidateTargetNote_;
    int candidateFrames_;
    float targetGuideMidi_;
    float correctionSemitones_;

    float shifterPhase_;
    float periodSamples_;
    float windowSamples_;
    float smoothedWindow_;
    float smoothedRatio_;

    float colorLowL_;
    float colorLowR_;

    void pushAnalysis(float mono);
    void analysePitch();
    void updateController(float hz, float confidence);
    void releaseUnvoiced();
    float readCubic(const float* ring, float pos) const;
    float processShiftedSample(const float* ring, int channel);
    float applyColor(float x, int channel);
};
