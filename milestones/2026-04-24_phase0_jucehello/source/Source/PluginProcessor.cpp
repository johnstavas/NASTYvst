#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace {
juce::AudioProcessorValueTreeState::ParameterLayout makeLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add (std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float>(0.0f, 2.0f, 0.0001f), 1.0f));
    return layout;
}
}

JuceHelloProcessor::JuceHelloProcessor()
    : juce::AudioProcessor (BusesProperties()
        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "PARAMS", makeLayout())
{}

bool JuceHelloProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto& main = layouts.getMainOutputChannelSet();
    return main == juce::AudioChannelSet::stereo()
        && layouts.getMainInputChannelSet() == main;
}

void JuceHelloProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const float gain = apvts.getRawParameterValue ("gain")->load();
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        buffer.applyGain (ch, 0, buffer.getNumSamples(), gain);
}

juce::AudioProcessorEditor* JuceHelloProcessor::createEditor()
{
    return new JuceHelloEditor (*this);
}

// JUCE plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new JuceHelloProcessor();
}
