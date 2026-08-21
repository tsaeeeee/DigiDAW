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
#if defined(DITUNE2_WASM)
    return static_cast<float>(js_sqrt(static_cast<double>(maxf(x, 0.0f))));
#else
    return std::sqrt(maxf(x, 0.0f));
#endif
}
inline float semitonesToRatio(float semis) { return expf_fast(semis * static_cast<float>(kLn2 / 12.0)); }
inline float hzToMidi(float hz, float ref) { return 69.0f + 12.0f * logf_fast(hz / ref) / static_cast<float>(kLn2); }
inline float midiToHz(float midi, float ref) { return ref * expf_fast((midi - 69.0f) * static_cast<float>(kLn2 / 12.0)); }
inline int roundi(float x) { return x >= 0.0f ? static_cast<int>(x + 0.5f) : static_cast<int>(x - 0.5f); }
inline float smoothCoeff(float sec, float sr) { return expf_fast(-1.0f / (maxf(sec, 1.0e-5f) * sr)); }
inline float wrapRing(float x) {
    while (x < 0.0f) x += static_cast<float>(Ditune2Engine::kRingSize);
    while (x >= static_cast<float>(Ditune2Engine::kRingSize)) x -= static_cast<float>(Ditune2Engine::kRingSize);
    return x;
}
}

void Ditune2Engine::init(float sr) {
    sampleRate_ = clampf(sr, 8000.0f, 192000.0f);
    reset();
}

void Ditune2Engine::reset() {
    writeIndex_ = framesWritten_ = 0;
    analysisWrite_ = analysisCount_ = downsampleCount_ = samplesSincePitch_ = 0;
    downsampleAccum_ = 0.0f;
    detectedHz_ = targetHz_ = confidence_ = centsDeviation_ = targetMidi_ = 0.0f;
    tracking_ = false;
    samplesSinceVoiced_ = 1000000;
    lastStableHz_ = octaveCandidateHz_ = 0.0f;
    octaveCandidateFrames_ = 0;
    measuredMidiFast_ = measuredMidiCenter_ = 0.0f;
    haveMidi_ = false;
    currentTargetNote_ = candidateTargetNote_ = candidateFrames_ = 0;
    targetGuideMidi_ = correctionSemitones_ = 0.0f;
    shifterPhase_ = 0.0f;
    periodSamples_ = 240.0f;
    windowSamples_ = smoothedWindow_ = 960.0f;
    smoothedRatio_ = 1.0f;
    colorLowL_ = colorLowR_ = 0.0f;
    inputRms_ = detectorQuality_ = voicedHoldMs_ = 0.0f;
    analysisReady_ = false;
    for (int i=0;i<kRingSize;++i) ringL_[i]=ringR_[i]=0.0f;
    for (int i=0;i<kAnalysisSize;++i) analysis_[i]=0.0f;
}

void Ditune2Engine::setParams(float ref, float speed, float humanize, float transition, float color, float hq) {
    referenceHz_ = clampf(ref, 415.0f, 466.0f);
    speed_ = clampf(speed, 0.0f, 100.0f);
    humanize_ = clampf(humanize, 0.0f, 100.0f);
    transition_ = clampf(transition, 0.0f, 100.0f);
    color_ = clampf(color, 0.0f, 100.0f);
    modeHQ_ = hq >= 0.5f ? 1.0f : 0.0f;
}

void Ditune2Engine::pushAnalysis(float mono) {
    downsampleAccum_ += mono;
    if (++downsampleCount_ < 4) return;
    const float averaged = downsampleAccum_ * 0.25f;
    downsampleAccum_ = 0.0f;
    downsampleCount_ = 0;
    analysis_[analysisWrite_] = averaged;
    analysisWrite_ = (analysisWrite_ + 1) % kAnalysisSize;
    if (analysisCount_ < kAnalysisSize) ++analysisCount_;
}

void Ditune2Engine::analysePitch() {
    constexpr int kWork = 1024;
    if (analysisCount_ < kWork) {
        analysisReady_ = false;
        return;
    }
    analysisReady_ = true;

    float x[kWork];
    const int start = (analysisWrite_ - kWork + kAnalysisSize) % kAnalysisSize;
    float mean = 0.0f;
    for (int i=0;i<kWork;++i) { x[i] = analysis_[(start+i)%kAnalysisSize]; mean += x[i]; }
    mean /= static_cast<float>(kWork);
    float rms = 0.0f;
    for (int i=0;i<kWork;++i) { x[i] -= mean; rms += x[i]*x[i]; }
    rms = sqrtf_fast(rms/static_cast<float>(kWork));
    inputRms_ = rms;
    if (rms < 0.0012f) { detectorQuality_ = 0.0f; rejectPitch(0.0f); return; }

    const float ar = sampleRate_ * 0.25f;
    const int safeMin = static_cast<int>(ar/1050.0f) < 2 ? 2 : static_cast<int>(ar/1050.0f);
    int safeMax = static_cast<int>(ar/55.0f);
    if (safeMax > 220) safeMax = 220;
    const int comparisonLength = kWork - safeMax - 2;

    float diff[222] = {};
    float cmnd[222] = {};
    for (int tau=1;tau<=safeMax+1;++tau) {
        float d=0.0f;
        for (int i=0;i<comparisonLength;++i) {
            const float delta=x[i]-x[i+tau];
            d += delta*delta;
        }
        diff[tau]=d;
    }
    float running=0.0f;
    cmnd[0]=1.0f;
    for (int tau=1;tau<=safeMax+1;++tau) {
        running += diff[tau];
        cmnd[tau] = running > 1.0e-12f ? diff[tau]*static_cast<float>(tau)/running : 1.0f;
    }

    const float threshold = modeHQ_ > 0.5f ? 0.11f : 0.15f;
    int lag=-1;
    for (int tau=safeMin;tau<=safeMax;++tau) {
        if (cmnd[tau] < threshold) {
            while (tau+1<=safeMax && cmnd[tau+1] < cmnd[tau]) ++tau;
            lag=tau; break;
        }
    }
    if (lag < 0) {
        int best=safeMin;
        for (int tau=safeMin+1;tau<=safeMax;++tau) if (cmnd[tau] < cmnd[best]) best=tau;
        if (cmnd[best] <= 0.42f) lag=best;
    }
    if (lag < 0) { detectorQuality_=0.0f; rejectPitch(0.0f); return; }

    float refined=static_cast<float>(lag);
    if (lag>safeMin && lag<safeMax) {
        const float l=cmnd[lag-1], c=cmnd[lag], r=cmnd[lag+1];
        const float denom=l-2.0f*c+r;
        if (absf(denom)>1.0e-9f) refined += 0.5f*(l-r)/denom;
    }
    const float hz=ar/maxf(refined,1.0f);
    const float conf=clampf(1.0f-cmnd[lag],0.0f,1.0f);
    detectorQuality_=conf;
    const bool recent = samplesSinceVoiced_ < static_cast<int>(0.12f*sampleRate_);
    const float minConf = recent ? 0.42f : 0.50f;
    if (hz<55.0f || hz>1050.0f || conf<minConf) { rejectPitch(conf); return; }

    float accepted=hz;
    if (lastStableHz_>0.0f) {
        const float ratio=hz/lastStableHz_;
        const bool octaveLike=(ratio>1.82f&&ratio<2.18f)||(ratio>0.46f&&ratio<0.55f);
        if (octaveLike) {
            const float cr=octaveCandidateHz_>0.0f?hz/octaveCandidateHz_:99.0f;
            if (cr>0.94f&&cr<1.06f) ++octaveCandidateFrames_;
            else { octaveCandidateHz_=hz; octaveCandidateFrames_=1; }
            if (octaveCandidateFrames_<3) accepted=lastStableHz_;
            else { octaveCandidateFrames_=0; octaveCandidateHz_=0.0f; }
        } else { octaveCandidateFrames_=0; octaveCandidateHz_=0.0f; }
    }
    acceptPitch(accepted,conf);
}

void Ditune2Engine::acceptPitch(float hz,float conf) {
    samplesSinceVoiced_=0;
    voicedHoldMs_=0.0f;
    tracking_=true;
    lastStableHz_=hz;
    updateController(hz,conf);
}

void Ditune2Engine::rejectPitch(float observedConfidence) {
    confidence_ = maxf(observedConfidence, confidence_*0.90f);
    const float elapsed = static_cast<float>(samplesSinceVoiced_) / sampleRate_;
    voicedHoldMs_ = elapsed*1000.0f;
    if (elapsed < 0.105f) return;
    tracking_ = false;
    const float hopSec = static_cast<float>(modeHQ_>0.5f?384:512)/sampleRate_;
    const float alpha = 1.0f-expf_fast(-hopSec/0.065f);
    correctionSemitones_ += (0.0f-correctionSemitones_)*alpha;
    if (elapsed > 0.26f) {
        detectedHz_=targetHz_=0.0f;
        haveMidi_=false;
        lastStableHz_=0.0f;
    }
}

void Ditune2Engine::updateController(float hz,float conf) {
    detectedHz_=hz; confidence_=conf; tracking_=true;
    const float midi=hzToMidi(hz,referenceHz_);
    if (!haveMidi_) {
        measuredMidiFast_=measuredMidiCenter_=midi;
        currentTargetNote_=roundi(midi);
        candidateTargetNote_=currentTargetNote_;
        targetGuideMidi_=static_cast<float>(currentTargetNote_);
        haveMidi_=true;
    }
    const float fastAlpha=modeHQ_>0.5f?0.30f:0.44f;
    measuredMidiFast_ += (midi-measuredMidiFast_)*fastAlpha;
    const float centerAlpha=0.045f+humanize_*0.0009f;
    measuredMidiCenter_ += (measuredMidiFast_-measuredMidiCenter_)*centerAlpha;

    const int nearest=roundi(measuredMidiCenter_);
    const float dist=absf(measuredMidiCenter_-static_cast<float>(currentTargetNote_));
    const float boundary=0.55f+humanize_*0.0008f;
    if (nearest!=currentTargetNote_ && dist>boundary) {
        if (nearest==candidateTargetNote_) ++candidateFrames_;
        else { candidateTargetNote_=nearest; candidateFrames_=1; }
        const int needed=conf>0.82f?2:3;
        if (candidateFrames_>=needed) { currentTargetNote_=nearest; candidateFrames_=0; }
    } else { candidateTargetNote_=currentTargetNote_; candidateFrames_=0; }

    const float t=transition_*0.01f;
    const float glide=0.004f+t*t*0.22f;
    const float hopSec=static_cast<float>(modeHQ_>0.5f?384:512)/sampleRate_;
    const float ga=1.0f-expf_fast(-hopSec/maxf(glide,0.001f));
    targetGuideMidi_ += (static_cast<float>(currentTargetNote_)-targetGuideMidi_)*ga;

    const float deviation=targetGuideMidi_-measuredMidiFast_;
    const float human=humanize_*0.01f;
    const float dead=0.008f+human*0.060f;
    float desired=0.0f;
    if (absf(deviation)>dead) {
        const float sign=deviation<0.0f?-1.0f:1.0f;
        desired=sign*(absf(deviation)-dead)*(1.0f-human*0.52f);
    }
    desired=clampf(desired,-1.75f,1.75f);
    const float s=speed_*0.01f;
    const float ms=2.5f+(1.0f-s)*(1.0f-s)*165.0f+human*38.0f;
    const float sa=1.0f-expf_fast(-hopSec/maxf(ms*0.001f,0.001f));
    correctionSemitones_ += (desired-correctionSemitones_)*sa;

    targetMidi_=targetGuideMidi_;
    targetHz_=midiToHz(targetGuideMidi_,referenceHz_);
    centsDeviation_=(midi-static_cast<float>(roundi(midi)))*100.0f;
    periodSamples_=clampf(sampleRate_/hz,40.0f,900.0f);
    const float cycles=modeHQ_>0.5f?6.0f:4.0f;
    windowSamples_=clampf(periodSamples_*cycles,192.0f,4096.0f);
}

float Ditune2Engine::readCubic(const float* ring,float pos) const {
    pos=wrapRing(pos); const int i1=static_cast<int>(pos); const float t=pos-static_cast<float>(i1);
    const int i0=(i1-1+kRingSize)%kRingSize, i2=(i1+1)%kRingSize, i3=(i1+2)%kRingSize;
    const float y0=ring[i0],y1=ring[i1],y2=ring[i2],y3=ring[i3];
    const float a0=-0.5f*y0+1.5f*y1-1.5f*y2+0.5f*y3;
    const float a1=y0-2.5f*y1+2.0f*y2-0.5f*y3;
    const float a2=-0.5f*y0+0.5f*y2;
    return ((a0*t+a1)*t+a2)*t+y1;
}

float Ditune2Engine::processShiftedSample(const float* ring) {
    smoothedWindow_ += (windowSamples_-smoothedWindow_)*0.0008f;
    smoothedWindow_=clampf(smoothedWindow_,192.0f,4096.0f);
    const bool voiceHeld=samplesSinceVoiced_<static_cast<int>(0.105f*sampleRate_);
    const float targetRatio=semitonesToRatio(voiceHeld?correctionSemitones_:0.0f);
    const float ra=1.0f-smoothCoeff(0.0045f,sampleRate_);
    smoothedRatio_ += (targetRatio-smoothedRatio_)*ra;
    const float cents=absf(12.0f*logf_fast(maxf(smoothedRatio_,1.0e-6f))/static_cast<float>(kLn2)*100.0f);
    if (cents<1.25f) {
        float d=-shifterPhase_; if(d<-0.5f)d+=1.0f; if(d>0.5f)d-=1.0f; shifterPhase_+=d*0.0018f;
    } else shifterPhase_ += (1.0f-smoothedRatio_)/smoothedWindow_;
    shifterPhase_-=static_cast<int>(shifterPhase_); if(shifterPhase_<0.0f)shifterPhase_+=1.0f;
    const float pa=shifterPhase_; float pb=pa+0.5f; if(pb>=1.0f)pb-=1.0f;
    const float ga=0.5f-0.5f*cosf_fast(static_cast<float>(2.0*kPi)*pa), gb=1.0f-ga;
    const float base=smoothedWindow_*0.60f+periodSamples_*1.5f;
    return readCubic(ring,static_cast<float>(writeIndex_)-base-pa*smoothedWindow_)*ga +
           readCubic(ring,static_cast<float>(writeIndex_)-base-pb*smoothedWindow_)*gb;
}

float Ditune2Engine::applyColor(float x,int ch) {
    const float a=expf_fast(static_cast<float>(-2.0*kPi)*4800.0f/sampleRate_);
    float& low=ch==0?colorLowL_:colorLowR_; low=(1.0f-a)*x+a*low;
    const float high=x-low; const float db=(color_-50.0f)*0.05f;
    return low+high*expf_fast(db*static_cast<float>(kLn10/20.0));
}

void Ditune2Engine::process(const float* inL,const float* inR,float* outL,float* outR,int frames) {
    if(frames<0)frames=0; if(frames>kBlock)frames=kBlock;
    const int hop=modeHQ_>0.5f?384:512;
    float blockEnergy=0.0f;
    for(int i=0;i<frames;++i) {
        const float xL=inL?inL[i]:0.0f, xR=inR?inR[i]:xL;
        blockEnergy += 0.5f*(xL*xL+xR*xR);
        ringL_[writeIndex_]=xL; ringR_[writeIndex_]=xR;
        if(framesWritten_<kRingSize)++framesWritten_;
        if(samplesSinceVoiced_<2000000000)++samplesSinceVoiced_;
        pushAnalysis(0.5f*(xL+xR));
        if(++samplesSincePitch_>=hop){ samplesSincePitch_=0; analysePitch(); }

        const float required=smoothedWindow_*1.7f+periodSamples_*2.0f+8.0f;
        float yL=xL,yR=xR;
        if(framesWritten_>static_cast<int>(required)) {
            yL=processShiftedSample(ringL_);
            const float pa=shifterPhase_; float pb=pa+0.5f; if(pb>=1.0f)pb-=1.0f;
            const float ga=0.5f-0.5f*cosf_fast(static_cast<float>(2.0*kPi)*pa),gb=1.0f-ga;
            const float base=smoothedWindow_*0.60f+periodSamples_*1.5f;
            yR=readCubic(ringR_,static_cast<float>(writeIndex_)-base-pa*smoothedWindow_)*ga+
               readCubic(ringR_,static_cast<float>(writeIndex_)-base-pb*smoothedWindow_)*gb;
        }
        outL[i]=applyColor(yL,0); outR[i]=applyColor(yR,1);
        writeIndex_=(writeIndex_+1)%kRingSize;
    }
    const float blockRms=sqrtf_fast(blockEnergy/maxf(static_cast<float>(frames),1.0f));
    inputRms_ += (blockRms-inputRms_)*0.22f;
    voicedHoldMs_=static_cast<float>(samplesSinceVoiced_)*1000.0f/sampleRate_;
}