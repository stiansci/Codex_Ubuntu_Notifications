"""Verify native notification argument types, cleanup and bounded private input."""

import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("native_notification", Path(__file__).resolve().parents[1] / "lib/native_notification.py")
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class Function:
    def __init__(self, result):
        self.result, self.calls = result, []

    def __call__(self, *args):
        self.calls.append(args)
        return self.result


class Library:
    def __init__(self, **results):
        for name, result in results.items():
            setattr(self, name, Function(result))


class NativeNotificationTests(unittest.TestCase):
    def test_unicode_payload_is_encoded_for_libnotify_and_released_on_success_or_failure(self):
        for success in (0, 1):
            notify = Library(notify_init=1, notify_notification_new=42,
                             notify_notification_show=success, notify_uninit=None)
            gobject = Library(g_object_unref=None)
            glib = Library(g_error_free=None)
            with patch.object(native.ctypes, "CDLL", side_effect=[notify, gobject, glib]):
                self.assertEqual(native.send({"summary": "Città", "body": "<b>日本語</b>", "icon": "/tmp/icon.png"}), bool(success))
            self.assertEqual(notify.notify_notification_new.calls[0], ("Città".encode(), "<b>日本語</b>".encode(), b"/tmp/icon.png"))
            self.assertEqual(gobject.g_object_unref.calls, [(42,)])
            self.assertEqual(len(notify.notify_uninit.calls), 1)

    def test_invalid_fields_never_reach_native_libraries(self):
        with patch.object(native.ctypes, "CDLL") as load:
            for payload in ({"body": "bad\0text"}, {"body": []}):
                with self.assertRaises(ValueError):
                    native.send(payload)
            load.assert_not_called()

    def test_invalid_or_oversized_stdin_cannot_send_a_notification(self):
        for data in (b"null", b"[]", b"{", b"x" * (native.MAX_PAYLOAD_BYTES + 1)):
            with patch.object(native.sys, "stdin") as stdin, patch.object(native, "send") as send:
                stdin.buffer = io.BytesIO(data)
                self.assertEqual(native.main(), 1)
                send.assert_not_called()
        with patch.object(native.sys, "stdin") as stdin, patch.object(native, "send", return_value=True) as send:
            stdin.buffer = io.BytesIO(json.dumps({"body": "Synthetic answer"}).encode())
            self.assertEqual(native.main(), 0)
            send.assert_called_once_with({"body": "Synthetic answer"})


if __name__ == "__main__":
    unittest.main()
