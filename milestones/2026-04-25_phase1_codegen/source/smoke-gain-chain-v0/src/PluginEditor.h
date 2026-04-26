// SmokeGainChainV0 editor — knob/slider/peak-meter/bypass per buildout § 4.4.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class PeakMeterStrip : public juce::Component, private juce::Timer {
public:
    PeakMeterStrip(SmokeGainChainV0AudioProcessor& p) : proc_(p) { startTimerHz(30); }
    void paint(juce::Graphics& g) override;
private:
    void timerCallback() override { repaint(); }
    SmokeGainChainV0AudioProcessor& proc_;
    float holdL_ = 0.0f, holdR_ = 0.0f;
    int   holdCountL_ = 0, holdCountR_ = 0;
};

class SmokeGainChainV0Editor : public juce::AudioProcessorEditor {
public:
    explicit SmokeGainChainV0Editor(SmokeGainChainV0AudioProcessor&);
    ~SmokeGainChainV0Editor() override = default;
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    SmokeGainChainV0AudioProcessor& proc_;

    juce::TextButton bypassBtn_ { "Bypass" };
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> bypassAttach_;


    juce::Slider n_gain_a__gainDb_slider_;
    juce::Label  n_gain_a__gainDb_label_;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> n_gain_a__gainDb_attach_;

    juce::Slider n_gain_b__gainDb_slider_;
    juce::Label  n_gain_b__gainDb_label_;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> n_gain_b__gainDb_attach_;


    PeakMeterStrip meter_ { proc_ };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SmokeGainChainV0Editor)
};
