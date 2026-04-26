// parity_host/main.cpp — load a .vst3, render WAV→WAV with sample-precise blocks.
// Per memory/codegen_pipeline_buildout.md § 5.2.
//
// Usage:
//   parity_host --vst3 PATH --in input.wav --out output.wav
//                [--sr 48000] [--block 512] [--params params.json]
//
// params.json shape:
//   { "n_gain__gainDb": -6.0, ... }    // keys = APVTS paramId, values = raw numeric

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

#include <cstdio>
#include <cstdlib>
#include <memory>

using juce::String;

static String getArg(const juce::StringArray& a, const String& key, const String& def = {}) {
    int i = a.indexOf(key);
    if (i < 0 || i + 1 >= a.size()) return def;
    return a[i + 1];
}

static int fail(const String& msg) {
    std::fprintf(stderr, "[parity_host] FAIL: %s\n", msg.toRawUTF8());
    return 1;
}

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI juceInit;

    juce::StringArray args;
    for (int i = 1; i < argc; ++i) args.add(String::fromUTF8(argv[i]));

    const String vst3Path  = getArg(args, "--vst3");
    const String inPath    = getArg(args, "--in");
    const String outPath   = getArg(args, "--out");
    const double sr        = getArg(args, "--sr",    "48000").getDoubleValue();
    const int    block     = getArg(args, "--block", "512").getIntValue();
    const String paramsPath = getArg(args, "--params");

    if (vst3Path.isEmpty() || inPath.isEmpty() || outPath.isEmpty())
        return fail("--vst3, --in, --out are required");

    juce::File vst3File (vst3Path);
    juce::File inFile   (inPath);
    juce::File outFile  (outPath);

    if (!vst3File.exists()) return fail("vst3 not found: " + vst3Path);
    if (!inFile.existsAsFile()) return fail("input wav not found: " + inPath);

    // ── Load plugin ─────────────────────────────────────────────────────
    juce::AudioPluginFormatManager fm;
    fm.addDefaultFormats(); // includes VST3 when JUCE_PLUGINHOST_VST3=1

    juce::OwnedArray<juce::PluginDescription> descs;
    juce::VST3PluginFormat vst3Fmt;
    vst3Fmt.findAllTypesForFile(descs, vst3File.getFullPathName());
    if (descs.isEmpty()) return fail("no VST3 types in " + vst3Path);

    String err;
    auto plugin = fm.createPluginInstance(*descs[0], sr, block, err);
    if (plugin == nullptr) return fail("createPluginInstance: " + err);

    // Channel layout: match the input WAV's channel count.
    juce::AudioFormatManager afm;
    afm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader (afm.createReaderFor(inFile));
    if (reader == nullptr) return fail("could not read input wav");

    const int numChans   = (int) reader->numChannels;
    const juce::int64 N  = reader->lengthInSamples;
    plugin->setPlayConfigDetails(numChans, numChans, sr, block);
    plugin->prepareToPlay(sr, block);

    auto getParamID = [](juce::AudioProcessorParameter* p) -> String {
        if (auto* hp = dynamic_cast<juce::AudioPluginInstance::HostedParameter*> (p))
            return hp->getParameterID();
        if (auto* rp = dynamic_cast<juce::AudioProcessorParameterWithID*> (p))
            return rp->paramID;
        return "(no-id)";
    };

    // ── Dump available params (--list-params) ───────────────────────────
    if (args.contains("--list-params")) {
        std::printf("[parity_host] %d parameters:\n", plugin->getParameters().size());
        for (auto* p : plugin->getParameters()) {
            std::printf("  idx=%d name='%s' id='%s' val=%.4f\n",
                p->getParameterIndex(),
                p->getName(64).toRawUTF8(),
                getParamID(p).toRawUTF8(),
                p->getValue());
        }
    }

    // ── Apply param overrides ───────────────────────────────────────────
    if (paramsPath.isNotEmpty()) {
        juce::File pf (paramsPath);
        if (!pf.existsAsFile()) return fail("params not found: " + paramsPath);
        auto json = juce::JSON::parse(pf);
        if (auto* obj = json.getDynamicObject()) {
            for (auto& kv : obj->getProperties()) {
                const String key = kv.name.toString();
                const float  val = (float) (double) kv.value;
                bool matched = false;
                for (auto* p : plugin->getParameters()) {
                    if (getParamID(p) == key) {
                        if (auto* rp = dynamic_cast<juce::RangedAudioParameter*> (p)) {
                            const auto& rng = rp->getNormalisableRange();
                            const float norm = rng.convertTo0to1(val);
                            rp->setValueNotifyingHost(norm);
                        } else {
                            // Hosted parameter with no exposed range — assume value is already normalised.
                            p->setValueNotifyingHost(val);
                        }
                        matched = true;
                        break;
                    }
                }
                if (!matched)
                    std::fprintf(stderr, "[parity_host] WARN: param '%s' not found\n", key.toRawUTF8());
            }
        }
    }

    // ── Render ──────────────────────────────────────────────────────────
    juce::AudioBuffer<float> inBuf  (numChans, (int) N);
    reader->read(&inBuf, 0, (int) N, 0, true, true);

    juce::AudioBuffer<float> outBuf (numChans, (int) N);
    outBuf.clear();

    juce::AudioBuffer<float> work (numChans, block);
    juce::MidiBuffer midi;

    for (juce::int64 pos = 0; pos < N; pos += block) {
        const int n = (int) juce::jmin ((juce::int64) block, N - pos);
        work.setSize(numChans, block, false, false, true);
        work.clear();
        for (int ch = 0; ch < numChans; ++ch)
            work.copyFrom(ch, 0, inBuf, ch, (int) pos, n);
        // pad tail of work with zeros if last block is partial (already cleared)
        midi.clear();
        plugin->processBlock(work, midi);
        for (int ch = 0; ch < numChans; ++ch)
            outBuf.copyFrom(ch, (int) pos, work, ch, 0, n);
    }

    plugin->releaseResources();

    // ── Write output WAV ────────────────────────────────────────────────
    outFile.deleteFile();
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::FileOutputStream> os (outFile.createOutputStream());
    if (os == nullptr) return fail("could not open output wav for writing");
    std::unique_ptr<juce::AudioFormatWriter> writer (
        wav.createWriterFor(os.get(), sr, (unsigned int) numChans, 32, {}, 0));
    if (writer == nullptr) return fail("could not create wav writer");
    os.release(); // writer owns it now
    if (!writer->writeFromAudioSampleBuffer(outBuf, 0, (int) N))
        return fail("writeFromAudioSampleBuffer failed");
    writer.reset(); // flush

    std::fprintf(stdout,
        "[parity_host] OK   in=%lld out=%lld ch=%d sr=%.0f block=%d params=%s\n",
        (long long) N, (long long) N, numChans, sr, block,
        paramsPath.isEmpty() ? "(none)" : paramsPath.toRawUTF8());
    return 0;
}
