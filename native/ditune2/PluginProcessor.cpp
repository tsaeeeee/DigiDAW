#include "PluginProcessor.h"

juce::AudioProcessorValueTreeState::ParameterLayout Ditune2AudioProcessor::createLayout() {
    using P = juce::AudioParameterFloat;
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<P>("reference", "Reference", juce::NormalisableRange<float>(415.f, 466.f, 0.1f), 440.f));
    layout.add(std::make_unique<P>("speed", "Speed", 0.f, 100.f, 75.f));
    layout.add(std::make_unique<P>("humanize", "Humanize", 0.f, 100.f, 20.f));
    layout.add(std::make_unique<P>("transition", "Transition", 0.f, 100.f, 30.f));
    layout.add(std::make_unique<P>("color", "Color", 0.f, 100.f, 50.f));
    layout.add(std::make_unique<juce::AudioParameterBool>("hq", "HQ", false));
    return layout;
}

Ditune2AudioProcessor::Ditune2AudioProcessor()
: AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
  state_(*this, nullptr, "PARAMETERS", createLayout()) {}

void Ditune2AudioProcessor::prepareToPlay(double sampleRate, int) {
    engine_.init(static_cast<float>(sampleRate));
}

bool Ditune2AudioProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    return l.getMainInputChannelSet() == l.getMainOutputChannelSet()
        && (l.getMainOutputChannelSet() == juce::AudioChannelSet::mono()
            || l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo());
}

void Ditune2AudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    const auto reference = state_.getRawParameterValue("reference")->load();
    const auto speed = state_.getRawParameterValue("speed")->load();
    const auto humanize = state_.getRawParameterValue("humanize")->load();
    const auto transition = state_.getRawParameterValue("transition")->load();
    const auto color = state_.getRawParameterValue("color")->load();
    const auto hq = state_.getRawParameterValue("hq")->load();
    engine_.setParams(reference, speed, humanize, transition, color, hq);

    const int channels = buffer.getNumChannels();
    for (int offset = 0; offset < buffer.getNumSamples(); offset += Ditune2Engine::kBlock) {
        const int n = juce::jmin(Ditune2Engine::kBlock, buffer.getNumSamples() - offset);
        for (int i = 0; i < n; ++i) {
            inL_[i] = buffer.getSample(0, offset + i);
            inR_[i] = channels > 1 ? buffer.getSample(1, offset + i) : inL_[i];
        }
        engine_.process(inL_.data(), inR_.data(), outL_.data(), outR_.data(), n);
        for (int i = 0; i < n; ++i) {
            buffer.setSample(0, offset + i, outL_[i]);
            if (channels > 1) buffer.setSample(1, offset + i, outR_[i]);
        }
    }
}

void Ditune2AudioProcessor::getStateInformation(juce::MemoryBlock& dest) {
    if (auto xml = state_.copyState().createXml()) copyXmlToBinary(*xml, dest);
}

void Ditune2AudioProcessor::setStateInformation(const void* data, int size) {
    if (auto xml = getXmlFromBinary(data, size)) state_.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new Ditune2AudioProcessor(); }
