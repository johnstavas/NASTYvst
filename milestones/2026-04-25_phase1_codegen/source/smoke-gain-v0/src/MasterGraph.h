// MasterGraph — generated from smoke-gain-v0.
// One member per node, fan-out per-block in process(). DO NOT hand-edit.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <cstring>


#include "ops/op_n_gain.h"


namespace shags::codegen {

class MasterGraph {
public:
    MasterGraph() = default;
    void prepare(double sampleRate, int maxBlockSize);
    void reset();
    void process(juce::AudioBuffer<float>& buffer);
    int  getLatency() const { return latencySamples_; }
    void setParam(const char* nodeId, const char* opParamId, double v);

private:
    double sampleRate_ = 44100.0;
    int    maxBlock_   = 0;
    int    latencySamples_ = 0;

    // Scratch: one Float32 buffer per PCOF buffer slot.
    std::vector<std::vector<float>> scratch_;

    // One member per node — name = n_<nodeId>_

    shags::ops::GainOp_n_gain n_gain_;

};

}  // namespace shags::codegen
