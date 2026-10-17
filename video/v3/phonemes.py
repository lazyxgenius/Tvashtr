"""The sound check (V3b, brief video-v3b D2): what a line's checked word sounds like, phoneme by phoneme.

    PY=video/voice-venv/bin/python
    $PY video/v3/phonemes.py 3.1 video/out/v3/lines/3.1.wav   # SOUND 3.1 … PASS|FAIL [a] h ʌ l [moving]

Speech-to-text can't settle these words (Whisper hears "whole" for a good "Hull"), so a phoneme
recogniser does: facebook/wav2vec2-lv-60-espeak-cv-ft (Apache-2.0, from the Hugging Face cache; its
tokenizer loads with do_phonemize=False, so no espeak), run on CPU (deterministic). The checked word is
what sounds between its neighbours: each neighbour is found in the phonemes as its own sound ("a" = ɐ,
"moving" = m uː …), the match nearest that word's edge in voice.py's transcriber word times (Whisper's
word starts run late, so its times alone hand a word's last phoneme to the next word).
"""

import re
import sys
from pathlib import Path

MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
REVISION = "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"
# scene → the checked word between its neighbours (script words, lowercase, and how each neighbour
# sounds at the checked word's side), and the phonemes that must / must never sound in it (the
# brief's rules: 3.1 "Hull" with ʌ, never oʊ — V3's renders said "hole", h oʊ l; 4.2 "in", never æ or
# d — V3's said "and", æ n d). `only`: the word holds nothing but its own sounds, so another word
# ("hut" h ʌ t, "it" ɪ t, a weak "and" ə n) can't pass either; 4.2's vowel must sound, so a dropped
# word can't pass.
CHECKS = {
    "3.1": {"before": "a", "before_ph": [["ɐ"], ["ə"], ["eɪ"]], "word": "hull",
            "after": "moving", "after_ph": [["m", "uː"], ["m", "u"]],
            "must": [["ʌ"]], "never": ["oʊ"], "only": ["h", "ʌ", "l", "ɫ", "əl"]},
    "4.2": {"before": "you", "before_ph": [["j", "uː"], ["j", "u"], ["j", "ʊ"]], "word": "in",
            "after": "needs", "after_ph": [["n", "iː"], ["n", "i"]],
            "must": [["ɪ", "ᵻ", "i"]], "never": ["æ", "d"], "only": ["ɪ", "ᵻ", "i", "n"]},
}
NEAR_S = 0.3  # a neighbour's sound must be this close to its word's edge in the transcript

_model = None


def load():
    global _model
    if _model is None:
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC, Wav2Vec2PhonemeCTCTokenizer

        torch.manual_seed(0)
        _model = (
            Wav2Vec2FeatureExtractor.from_pretrained(MODEL, revision=REVISION),
            Wav2Vec2PhonemeCTCTokenizer.from_pretrained(MODEL, revision=REVISION, do_phonemize=False),
            Wav2Vec2ForCTC.from_pretrained(MODEL, revision=REVISION).eval(),
        )
    return _model


def phones(path):
    """[(phoneme, start_s, end_s)]: greedy CTC (argmax per 20 ms frame, repeats merged, blanks dropped)."""
    import librosa
    import torch

    features, tokenizer, model = load()
    audio, sr = librosa.load(path, sr=16000, mono=True)
    inputs = features(audio, sampling_rate=sr, return_tensors="pt")
    with torch.no_grad():
        ids = model(inputs.input_values).logits[0].argmax(-1).tolist()
    step = model.config.inputs_to_logits_ratio / sr
    out, prev = [], None
    for i, t in enumerate(ids):
        if t != prev and t != tokenizer.pad_token_id:
            out.append([tokenizer.convert_ids_to_tokens(t), i * step, (i + 1) * step])
        elif t == prev and t != tokenizer.pad_token_id:
            out[-1][2] = (i + 1) * step
        prev = t
    return [tuple(p) for p in out]


def _w(word):
    return re.sub(r"[^a-z']", "", word.lower())


def window(words, check):
    """The checked word's gap in Whisper's words: after `before` ends, before `after` starts (1–2 words
    heard between them). None when the transcript has no such place."""
    for b in range(len(words)):
        for a in (b + 2, b + 3):
            if a < len(words) and _w(words[b]["word"]) == check["before"] and _w(words[a]["word"]) == check["after"]:
                return words[b], words[a]
    return None


def anchor(ph, pats, t, side):
    """(start, end) indices of the match of one of `pats` whose word-side edge is nearest `t` (the
    before word's end, side="end"; the after word's start, side="start"), or None past NEAR_S."""
    best = None
    for i in range(len(ph)):
        for pat in pats:
            if [p[0] for p in ph[i : i + len(pat)]] == pat:
                j = i + len(pat) - 1
                gap = abs((ph[j][2] if side == "end" else ph[i][1]) - t)
                if gap <= NEAR_S and (best is None or gap < best[0]):
                    best = (gap, i, j)
    return best and best[1:]


def sound(scene, path, words, ph=None):
    """(pass, what was heard): the checked word's phonemes, its neighbours' in brackets."""
    check = CHECKS[scene]
    hit = window(words, check)
    if not hit:
        return False, f"no '{check['before']} … {check['after']}' in the words"
    ph = ph if ph is not None else phones(path)
    left = anchor(ph, check["before_ph"], hit[0]["end"], "end")
    right = anchor(ph, check["after_ph"], hit[1]["start"], "start")
    if not left or not right or left[1] >= right[0]:
        return False, f"neighbours not heard: {' '.join(p[0] for p in ph)}"
    said = [p[0] for p in ph[left[1] + 1 : right[0]]]
    ok = (all(any(x in said for x in alts) for alts in check["must"])
          and not any(x in said for x in check["never"]) and all(x in check["only"] for x in said))
    show = lambda a, b: " ".join(p[0] for p in ph[a : b + 1])  # noqa: E731
    return ok, f"[{show(*left)}] {' '.join(said) or '∅'} [{show(*right)}]"


def main():
    from voice import transcribe

    scene, paths = sys.argv[1], sys.argv[2:]
    for path in paths:
        text, words = transcribe(path)
        ok, heard = sound(scene, path, words)
        print(f"SOUND {scene} {Path(path).name} {'PASS' if ok else 'FAIL'} {heard} | {text}", flush=True)


if __name__ == "__main__":
    main()
