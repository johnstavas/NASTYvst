// SmokeGainChainV0 — generated PluginProcessor implementation.
// DO NOT hand-edit. Regenerate via: node src/sandbox/codegen/build_native.mjs <graph.json>
#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace {
    inline float peakAbs(const float* p, int n) {
        float m = 0.0f;
        for (int i = 0; i < n; ++i) {
            const float a = std::fabs(p[i]);
            if (a > m) m = a;
        }
        return m;
    }
}

juce::AudioProcessorValueTreeState::ParameterLayout
SmokeGainChainV0AudioProcessor::makeLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "bypass", 1 }, "Bypass", false));


    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { "n_gain_a__gainDb", 1 },
        "Gain",
        juce::NormalisableRange<float>(-60.0000f, 24.0000f, 0.1000f),
        -6.0000f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { "n_gain_b__gainDb", 1 },
        "Gain",
        juce::NormalisableRange<float>(-60.0000f, 24.0000f, 0.1000f),
        -6.0000f));


    return layout;
}

SmokeGainChainV0AudioProcessor::SmokeGainChainV0AudioProcessor()
  : juce::AudioProcessor(BusesProperties()
        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
    apvts(*this, nullptr, "PARAMS", makeLayout())
{
    bypass_ = dynamic_cast<juce::AudioParameterBool*>(apvts.getParameter("bypass"));
}

bool SmokeGainChainV0AudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto& main = layouts.getMainOutputChannelSet();
    if (main != juce::AudioChannelSet::mono() && main != juce::AudioChannelSet::stereo())
        return false;
    return main == layouts.getMainInputChannelSet();
}

void SmokeGainChainV0AudioProcessor::prepareToPlay(double sr, int blockSize) {
    graph_.prepare(sr, blockSize);
    setLatencySamples(graph_.getLatency());
}

void SmokeGainChainV0AudioProcessor::releaseResources() {}

void SmokeGainChainV0AudioProcessor::reset() { graph_.reset(); }

void SmokeGainChainV0AudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    const int N        = buffer.getNumSamples();
    const int numIn    = getTotalNumInputChannels();
    const int numOut   = getTotalNumOutputChannels();

    // Clear any output channels we don't write into.
    for (int ch = numIn; ch < numOut; ++ch)
        buffer.clear(ch, 0, N);

    // Input metering (peak, pre-graph).
    if (numIn >= 1) levelInL_.store(peakAbs(buffer.getReadPointer(0), N));
    if (numIn >= 2) levelInR_.store(peakAbs(buffer.getReadPointer(1), N));

    // Push current APVTS values into graph (block-rate).

    graph_.setParam("n_gain_a", "gainDb", apvts.getRawParameterValue("n_gain_a__gainDb")->load());

    graph_.setParam("n_gain_b", "gainDb", apvts.getRawParameterValue("n_gain_b__gainDb")->load());


    if (bypass_ != nullptr && bypass_->get()) {
        // Bypass: passthrough, sample-bit-identical. Re-tap output for meter parity.
        if (numOut >= 1) levelOutL_.store(peakAbs(buffer.getReadPointer(0), N));
        if (numOut >= 2) levelOutR_.store(peakAbs(buffer.getReadPointer(1), N));
        return;
    }

    graph_.process(buffer);

    if (numOut >= 1) levelOutL_.store(peakAbs(buffer.getReadPointer(0), N));
    if (numOut >= 2) levelOutR_.store(peakAbs(buffer.getReadPointer(1), N));
}

void SmokeGainChainV0AudioProcessor::processBlockBypassed(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    const int N      = buffer.getNumSamples();
    const int numOut = getTotalNumOutputChannels();
    if (numOut >= 1) levelInL_.store(peakAbs(buffer.getReadPointer(0), N));
    if (numOut >= 2) levelInR_.store(peakAbs(buffer.getReadPointer(1), N));
    if (numOut >= 1) levelOutL_.store(peakAbs(buffer.getReadPointer(0), N));
    if (numOut >= 2) levelOutR_.store(peakAbs(buffer.getReadPointer(1), N));
}

juce::AudioProcessorEditor* SmokeGainChainV0AudioProcessor::createEditor() {
    return new SmokeGainChainV0Editor(*this);
}

void SmokeGainChainV0AudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    if (xml != nullptr) copyXmlToBinary(*xml, destData);
}

void SmokeGainChainV0AudioProcessor::setStateInformation(const void* data, int sizeInBytes) {
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml != nullptr && xml->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new SmokeGainChainV0AudioProcessor();
}
