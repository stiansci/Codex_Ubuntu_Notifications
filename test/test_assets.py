"""Validate the bundled audio assets without exposing sound design source."""
from pathlib import Path
import struct
import unittest
import wave


ROOT = Path(__file__).resolve().parent.parent


class SoundAssetsTest(unittest.TestCase):
    def test_bundled_wav_files_are_short_stereo_pcm(self):
        for index in range(1, 5):
            sound_path = ROOT / "sounds" / f"synth-{index}.wav"
            with wave.open(str(sound_path), "rb") as sound:
                self.assertEqual((sound.getnchannels(), sound.getsampwidth(), sound.getframerate()), (2, 2, 44100))
                self.assertLess(sound.getnframes() / sound.getframerate(), 3)
                pcm = sound.readframes(sound.getnframes())
                peak = max(abs(value) for (value,) in struct.iter_unpack("<h", pcm))
                self.assertGreater(peak, 0)
                self.assertLess(peak, 16384)


if __name__ == "__main__":
    unittest.main()
