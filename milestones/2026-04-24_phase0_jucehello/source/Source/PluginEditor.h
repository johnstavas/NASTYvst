#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class JuceHelloEditor : public juce::AudioProcessorEditor
{
public:
    explicit JuceHelloEditor (JuceHelloProcessor& p)
        : juce::AudioProcessorEditor (&p), proc_ (p),
          generic_ (p)
    {
        addAndMakeVisible (generic_);
        setSize (400, 200);
    }

    void resized() override { generic_.setBounds (getLocalBounds()); }

private:
    JuceHelloProcessor& proc_;
    juce::GenericAudioProcessorEditor generic_;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (JuceHelloEditor)
};
