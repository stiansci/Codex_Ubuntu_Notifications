"""Send a native notification through libnotify with private data supplied on stdin."""

import ctypes
import json
import sys

MAX_PAYLOAD_BYTES = 64 * 1024


def send(payload):
    """Use Ubuntu's libnotify without putting answer text in a subprocess command line."""
    fields = [payload.get(key, "") for key in ("summary", "body", "icon")]
    if not all(isinstance(value, str) and "\0" not in value for value in fields):
        raise ValueError("Invalid notification")
    notify = ctypes.CDLL("libnotify.so.4")
    gobject = ctypes.CDLL("libgobject-2.0.so.0")
    glib = ctypes.CDLL("libglib-2.0.so.0")
    notify.notify_init.argtypes = [ctypes.c_char_p]
    notify.notify_init.restype = ctypes.c_int
    notify.notify_notification_new.argtypes = [ctypes.c_char_p] * 3
    notify.notify_notification_new.restype = ctypes.c_void_p
    notify.notify_notification_show.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    notify.notify_notification_show.restype = ctypes.c_int
    notify.notify_uninit.argtypes = []
    notify.notify_uninit.restype = None
    gobject.g_object_unref.argtypes = [ctypes.c_void_p]
    gobject.g_object_unref.restype = None
    glib.g_error_free.argtypes = [ctypes.c_void_p]
    glib.g_error_free.restype = None
    if not notify.notify_init(b"Codex Ubuntu Notifications"):
        return False
    notification, error = None, ctypes.c_void_p()
    try:
        notification = notify.notify_notification_new(*(value.encode("utf-8") for value in fields))
        return bool(notification and notify.notify_notification_show(notification, ctypes.byref(error)))
    finally:
        if error.value:
            glib.g_error_free(error)
        if notification:
            gobject.g_object_unref(notification)
        notify.notify_uninit()


def main():
    try:
        data = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
        if len(data) > MAX_PAYLOAD_BYTES:
            return 1
        payload = json.loads(data)
        if not isinstance(payload, dict):
            return 1
        return 0 if send(payload) else 1
    except (OSError, ValueError, TypeError):
        # Parent reports a generic channel failure without leaking private content.
        return 1


if __name__ == "__main__":
    sys.exit(main())
