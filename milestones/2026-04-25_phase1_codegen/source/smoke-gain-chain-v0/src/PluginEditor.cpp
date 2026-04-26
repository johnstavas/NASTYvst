// SmokeGainChainV0 editor implementation. Generated.
#include "PluginEditor.h"

static juce::Slider::SliderStyle styleFor(const juce::String& ui) {
    return ui == "slider" ? juce::Slider::LinearVertical
                          : juce::Slider::RotaryHorizontalVerticalDrag;
}

void PeakMeterStrip::paint(juce::Graphics& g) {
    auto bounds = getLocalBounds().toFloat();
    g.fillAll(juce::Colour::fromRGB(20, 22, 26));

    const float floorDb = -60.0f, ceilDb = 6.0f;
    auto dbToY = [&](float db) {
        const float t = juce::jlimit(0.0f, 1.0f, (ceilDb - db) / (ceilDb - floorDb));
        return bounds.getY() + t * bounds.getHeight();
    };

    const float peakL = juce::Decibels::gainToDecibels(proc_.levelOutL_.load(), floorDb);
    const float peakR = juce::Decibels::gainToDecibels(proc_.levelOutR_.load(), floorDb);

    if (peakL > holdL_) { holdL_ = peakL; holdCountL_ = 30; }
    else if (--holdCountL_ <= 0) holdL_ = juce::jmax(floorDb, holdL_ - 0.5f);
    if (peakR > holdR_) { holdR_ = peakR; holdCountR_ = 30; }
    else if (--holdCountR_ <= 0) holdR_ = juce::jmax(floorDb, holdR_ - 0.5f);

    const float halfW  = bounds.getWidth() * 0.5f;
    const float gap    = 4.0f;
    const float colW   = halfW - gap;

    auto drawCol = [&](float x, float peakDb, float holdDb, juce::Colour c) {
        juce::Rectangle<float> col (x, dbToY(peakDb), colW, bounds.getBottom() - dbToY(peakDb));
        g.setColour(c.withAlpha(0.85f));
        g.fillRect(col);
        g.setColour(juce::Colours::white);
        const float hy = dbToY(holdDb);
        g.fillRect(juce::Rectangle<float>(x, hy - 1.0f, colW, 2.0f));
    };

    drawCol(bounds.getX(),                    peakL, holdL_, juce::Colour::fromRGB(82, 200, 140));
    drawCol(bounds.getX() + halfW + gap*0.5f, peakR, holdR_, juce::Colour::fromRGB(82, 200, 140));

    g.setColour(juce::Colours::white.withAlpha(0.4f));
    g.drawRect(bounds, 1.0f);
}

SmokeGainChainV0Editor::SmokeGainChainV0Editor(SmokeGainChainV0AudioProcessor& p)
    : juce::AudioProcessorEditor(&p), proc_(p)
{
    bypassBtn_.setClickingTogglesState(true);
    addAndMakeVisible(bypassBtn_);
    bypassAttach_ = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
        proc_.apvts, "bypass", bypassBtn_);


    n_gain_a__gainDb_slider_.setSliderStyle(styleFor("slider"));
    n_gain_a__gainDb_slider_.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 60, 16);
    addAndMakeVisible(n_gain_a__gainDb_slider_);
    n_gain_a__gainDb_label_.setText("Gain", juce::dontSendNotification);
    n_gain_a__gainDb_label_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(n_gain_a__gainDb_label_);
    n_gain_a__gainDb_attach_ = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        proc_.apvts, "n_gain_a__gainDb", n_gain_a__gainDb_slider_);

    n_gain_b__gainDb_slider_.setSliderStyle(styleFor("slider"));
    n_gain_b__gainDb_slider_.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 60, 16);
    addAndMakeVisible(n_gain_b__gainDb_slider_);
    n_gain_b__gainDb_label_.setText("Gain", juce::dontSendNotification);
    n_gain_b__gainDb_label_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(n_gain_b__gainDb_label_);
    n_gain_b__gainDb_attach_ = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        proc_.apvts, "n_gain_b__gainDb", n_gain_b__gainDb_slider_);


    addAndMakeVisible(meter_);
    setSize(416, 280);
}

void SmokeGainChainV0Editor::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour::fromRGB(28, 30, 36));
    g.setColour(juce::Colour::fromRGB(220, 225, 230));
    g.setFont(16.0f);
    g.drawText("SmokeGainChainV0", getLocalBounds().removeFromTop(28), juce::Justification::centred);
}

void SmokeGainChainV0Editor::resized() {
    auto area = getLocalBounds();
    auto top  = area.removeFromTop(32);
    bypassBtn_.setBounds(top.removeFromRight(80).reduced(4));

    auto meterArea = area.removeFromRight(96).reduced(8);
    meter_.setBounds(meterArea);

    auto knobRow = area.reduced(8);
    const int knobCount = 2;
    if (knobCount > 0) {
        const int slotW = knobRow.getWidth() / knobCount;
        int x = knobRow.getX();

        {
            juce::Rectangle<int> slot(x, knobRow.getY(), slotW, knobRow.getHeight());
            n_gain_a__gainDb_label_.setBounds(slot.removeFromTop(18));
            n_gain_a__gainDb_slider_.setBounds(slot.reduced(6));
            x += slotW;
        }

        {
            juce::Rectangle<int> slot(x, knobRow.getY(), slotW, knobRow.getHeight());
            n_gain_b__gainDb_label_.setBounds(slot.removeFromTop(18));
            n_gain_b__gainDb_slider_.setBounds(slot.reduced(6));
            x += slotW;
        }

    }
}
