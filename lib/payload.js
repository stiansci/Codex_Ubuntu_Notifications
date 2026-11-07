"use strict";

const MAX_PAYLOAD_BYTES = 64 * 1024;

function parsePayload(text) {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
    return payload;
}

// Read private notification data from an anonymous pipe, never process arguments.
function readStdinPayload() {
    const { Gio } = imports.gi;
    // GioUnix is available on newer GLib; Ubuntu 22.04 exposes the class on Gio.
    let InputStream;
    try { InputStream = imports.gi.GioUnix.InputStream; } catch { InputStream = Gio.UnixInputStream; }
    const stream = new InputStream({ fd: 0, close_fd: false });
    const chunks = [];
    let size = 0;
    while (true) {
        const chunk = stream.read_bytes(4096, null).get_data();
        if (!chunk.length) break;
        size += chunk.length;
        if (size > MAX_PAYLOAD_BYTES) throw new Error("Payload too large");
        chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return parsePayload(imports.byteArray.toString(bytes));
}

if (typeof module !== "undefined") module.exports = { parsePayload, MAX_PAYLOAD_BYTES };
