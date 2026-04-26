// MasterGraph implementation — generated from smoke-gain-chain-v0.
// DO NOT hand-edit.
#include "MasterGraph.h"

namespace shags::codegen {

void MasterGraph::prepare(double sampleRate, int maxBlockSize) {
    sampleRate_ = sampleRate;
    maxBlock_   = maxBlockSize;
    scratch_.assign(3, std::vector<float>(maxBlockSize, 0.0f));

    n_gain_a_ = shags::ops::GainOp_n_gain_a(sampleRate);

    n_gain_b_ = shags::ops::GainOp_n_gain_b(sampleRate);



    n_gain_a_.setParam("gainDb", -6.000000);



    n_gain_b_.setParam("gainDb", -6.000000);


    reset();
    latencySamples_ = 0;

    if (n_gain_a_.getLatencySamples() > latencySamples_)
        latencySamples_ = n_gain_a_.getLatencySamples();

    if (n_gain_b_.getLatencySamples() > latencySamples_)
        latencySamples_ = n_gain_b_.getLatencySamples();

}

void MasterGraph::reset() {
    for (auto& b : scratch_) std::fill(b.begin(), b.end(), 0.0f);

    n_gain_a_.reset();

    n_gain_b_.reset();

}

void MasterGraph::setParam(const char* nodeId, const char* opParamId, double v) {

    if (std::strcmp(nodeId, "n_gain_a") == 0) { n_gain_a_.setParam(opParamId, v); return; }

    if (std::strcmp(nodeId, "n_gain_b") == 0) { n_gain_b_.setParam(opParamId, v); return; }

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

        n_gain_a_.process(scratch_[0].data(), nullptr, scratch_[1].data(), N);

        n_gain_b_.process(scratch_[1].data(), nullptr, scratch_[2].data(), N);


        // Output-terminal sum: accumulate every source buffer into outCh.

        std::memset(outCh, 0, sizeof(float) * (size_t)N);

        for (int i = 0; i < N; ++i) outCh[i] += scratch_[2][i];


    }
}

}  // namespace shags::codegen
