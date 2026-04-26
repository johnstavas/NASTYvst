// MasterGraph implementation — generated from smoke-gain-v0.
// DO NOT hand-edit.
#include "MasterGraph.h"

namespace shags::codegen {

void MasterGraph::prepare(double sampleRate, int maxBlockSize) {
    sampleRate_ = sampleRate;
    maxBlock_   = maxBlockSize;
    scratch_.assign(2, std::vector<float>(maxBlockSize, 0.0f));

    n_gain_ = shags::ops::GainOp_n_gain(sampleRate);



    n_gain_.setParam("gainDb", 0.000000);


    reset();
    latencySamples_ = 0;

    if (n_gain_.getLatencySamples() > latencySamples_)
        latencySamples_ = n_gain_.getLatencySamples();

}

void MasterGraph::reset() {
    for (auto& b : scratch_) std::fill(b.begin(), b.end(), 0.0f);

    n_gain_.reset();

}

void MasterGraph::setParam(const char* nodeId, const char* opParamId, double v) {

    if (std::strcmp(nodeId, "n_gain") == 0) { n_gain_.setParam(opParamId, v); return; }

}

void MasterGraph::process(juce::AudioBuffer<float>& buffer) {
    const int N         = buffer.getNumSamples();
    const int numIn     = buffer.getNumChannels();
    const int numChans  = numIn;

    // Per-channel: copy IN terminal -> scratch, run nodes, sum OUT terminal -> channel.
    for (int ch = 0; ch < numChans; ++ch) {
        const float* inCh = buffer.getReadPointer(ch);
        float*       outCh = buffer.getWritePointer(ch);

        // Load input-terminal buffers from this channel.

        std::memcpy(scratch_[0].data(), inCh, sizeof(float) * (size_t)N);


        // Topological dispatch.

        n_gain_.process(scratch_[0].data(), nullptr, scratch_[1].data(), N);


        // Output-terminal sum: accumulate every source buffer into outCh.

        std::memset(outCh, 0, sizeof(float) * (size_t)N);

        for (int i = 0; i < N; ++i) outCh[i] += scratch_[1][i];


    }
}

}  // namespace shags::codegen
