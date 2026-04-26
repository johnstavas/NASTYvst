// SmokeGainV0 editor — knob/slider/peak-meter/bypass per buildout § 4.4.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class PeakMeterStrip : public juce::Component, private juce::Timer {
public:
    PeakMeterStrip(SmokeGainV0AudioProcessor& p) : proc_(p) { startTimerHz(30); }
    void paint(juce::Graphics& g) override;
private:
    void timerCallback() override { repaint(); }
    SmokeGainV0AudioProcessor& proc_;
    float holdL_ = 0.0f, holdR_ = 0.0f;
    int   holdCountL_ = 0, holdCountR_ = 0;
};

class SmokeGainV0Editor : public juce::AudioProcessorEditor {
public:
    explicit SmokeGainV0Editor(SmokeGainV0AudioProcessor&);
    ~SmokeGainV0Editor() override = default;
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    SmokeGainV0AudioProcessor& proc_;

    juce::TextButton bypassBtn_ { "Bypass" };
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> bypassAttach_;


    juce::Slider n_gain__gainDb_slider_;
    juce::Label  n_gain__gainDb_label_;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> n_gain__gainDb_attach_;


    PeakMeterStrip meter_ { proc_ };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SmokeGainV0Editor)
};
