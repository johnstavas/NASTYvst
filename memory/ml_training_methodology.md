# ML Training Methodology — reference notes

Created 2026-04-27. Bookmark file for **training-side** research that informs
how we retrain or extend the ML ops we already ship at inference time
(`crepe`, `chromagram`, `mfcc`, `onset`, `pyin`, `yin`, etc.). These papers
do NOT define new ops — they describe how to *train* models that could
eventually back new or improved ops.

## Why this file exists

The op catalog (`sandbox_ops_catalog.md`) is for runtime DSP. ML ops in the
catalog are inference-only: pretrained weights or fixed math, no training
in the runtime path. But when we want to extend coverage (e.g. a custom
note-onset detector trained on Stav's drum library, or a CREPE variant
fine-tuned on monophonic vocals), we'll need training methodology. This is
where that lives.

---

## Bootstrap training for note onset / segmenter models

**Hu & Dannenberg, "A Bootstrap Method for Training an Accurate Audio
Segmenter," ISMIR 2005 (CMU).**
Local copy: `docs/primary_sources/hu_dannenberg/1128.pdf`.

### One-line summary
Iterative training scheme that eliminates the need for hand-labeled training
data — use audio↔MIDI alignment via Dynamic Time Warping to generate the
INITIAL note-boundary labels, train a neural net segmenter on those, then
use the segmenter's predictions to refine the boundaries, and repeat.

### Why it's interesting for us
- **Avoids the labeling bottleneck.** You don't need a human marking every
  attack/release in a training corpus. The DTW alignment of audio to its
  symbolic (MIDI) score gives you an initial guess, and the bootstrap loop
  refines from there.
- **Works on synthetic + real.** They start with synthesized audio (where
  ground truth is known) and bootstrap into real recordings.
- **Modular.** The "alignment" stage and the "segmentation" stage are
  separate models — you can swap in better aligners or segmenters as
  technology improves.

### Where it might apply in our pipeline

**1. CREPE retrain on our own data (catalog #78 crepe).**
The shipped CREPE weights are trained on a fixed set of monophonic
instruments. If we wanted a "Stav-flavored" CREPE that's tuned for vocal
runs, instrument timbres specific to your library, or guitar bends, we'd
need training data. This bootstrap method could generate that data from
audio↔MIDI pairs without manual pitch labeling.

**2. Custom note-onset detector for the existing `onset` op.**
The current `onset` op uses fixed math (spectral flux / phase deviation).
A learned onset detector could be more accurate, but training it requires
labeled note onsets. The bootstrap loop would use:
- DTW alignment of audio to MIDI score → initial onset guesses
- Train a small NN on those guesses
- Use the NN's predictions to refine onset positions
- Re-train, iterate

**3. Drum-hit segmenter (potential future op).**
If we ever want a "transient-aware drum splitter" op, same bootstrap pattern
applies: pair drum recordings to a MIDI drum track (or programmatic markers),
DTW-align, iteratively refine boundaries.

### Key technical details from the paper
- **Chromagram features for alignment.** 12-bin chroma vectors per 50 ms
  window. Audio chroma derived from FFT bin → pitch-class assignment + average.
  MIDI chroma derived directly from note events.
- **Dynamic Time Warping.** Standard DTW with weighted distance metric:
  diagonal step weighted by √2 to prevent diagonal-bias; horizontal/vertical
  steps allowed for silence handling.
- **Banded DTW for efficiency.** O(max(m,n)) instead of O(mn) by restricting
  search to a diagonal band, since alignment is expected ~near the diagonal.
- **Feed-forward NN segmenter.** Small network, several hand-engineered audio
  features as inputs, [0,1] segmentation probability output. The NN is
  trained on the bootstrap-generated labels.
- **Iteration count.** Paper shows convergence in ~3–5 bootstrap rounds.

### What we'd need to actually use this
- An audio↔MIDI corpus (we don't have one bundled — would need to either
  curate one or generate synthetically by rendering MIDI through a synth).
- A DTW implementation (have `correlation` and `chromagram` worklets — DTW
  is straightforward to write on top of those features).
- A training runtime — currently we have NO training infrastructure. CREPE
  weights are pretrained externally and bundled. Adding training would
  require Node-side TensorFlow.js or PyTorch + ONNX export.

### Status
Paper bookmarked for reference. **Not actively informing any work yet.**
Will resurface when:
- We hit a real CREPE accuracy issue on Stav's content
- We decide to ship a learned `onset` upgrade
- We start a "trained on Stav's library" agent layer

### Citation
Ning Hu and Roger B. Dannenberg, "A Bootstrap Method for Training an
Accurate Audio Segmenter," in *Proceedings of the International Conference
on Music Information Retrieval (ISMIR)*, 2005, pp. 223–226. Queen Mary,
University of London.

---

## Future entries

When we add the next ML training paper, it goes below as a new H2 section
following the same template (one-line summary · why it's interesting ·
where it applies · key technical details · what we'd need · citation).
