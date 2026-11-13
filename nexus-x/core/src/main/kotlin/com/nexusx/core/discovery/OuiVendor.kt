package com.nexusx.core.discovery

/**
 * Maps a MAC address OUI (first three bytes) to a manufacturer, using a small embedded table of
 * common prefixes. This is only ever consulted when a real MAC is known; it is never guessed from an
 * IP. Modern Android randomizes MACs, so many devices legitimately resolve to null, which the UI
 * shows as "unknown vendor" rather than inventing a name.
 */
object OuiVendor {
    // A compact subset of the IEEE OUI registry covering common consumer hardware. A production
    // build would ship the full registry as an asset; the lookup contract is identical.
    private val table: Map<String, String> = mapOf(
        "F0:9F:C2" to "Ubiquiti", "FC:EC:DA" to "Ubiquiti", "24:5A:4C" to "Ubiquiti",
        "B8:27:EB" to "Raspberry Pi", "DC:A6:32" to "Raspberry Pi", "E4:5F:01" to "Raspberry Pi",
        "00:1A:11" to "Google", "F4:F5:E8" to "Google", "54:60:09" to "Google",
        "3C:5A:B4" to "Google", "AC:67:B2" to "Espressif", "24:0A:C4" to "Espressif",
        "D8:3A:DD" to "Espressif", "A4:CF:12" to "Espressif",
        "00:17:88" to "Philips Hue", "EC:B5:FA" to "Philips Hue",
        "F0:18:98" to "Apple", "A4:83:E7" to "Apple", "D0:03:4B" to "Apple", "F8:FF:C2" to "Apple",
        "AC:BC:32" to "Apple", "28:CF:E9" to "Apple", "3C:06:30" to "Apple",
        "FC:FB:FB" to "Cisco", "00:1B:54" to "Cisco", "00:0C:29" to "VMware", "00:50:56" to "VMware",
        "08:00:27" to "VirtualBox", "52:54:00" to "QEMU/KVM",
        "00:1D:D8" to "Microsoft", "C8:3F:26" to "Microsoft", "28:18:78" to "Microsoft",
        "DC:A4:CA" to "Amazon", "FC:65:DE" to "Amazon", "44:65:0D" to "Amazon",
        "50:DC:E7" to "Amazon", "68:54:FD" to "Amazon",
        "8C:85:80" to "Samsung", "5C:0A:5B" to "Samsung", "E8:50:8B" to "Samsung",
        "D0:17:C2" to "Samsung", "34:14:5F" to "Samsung", "F0:5A:09" to "Samsung",
        "B4:E6:2D" to "Espressif", "18:FE:34" to "Espressif",
        "00:1E:C2" to "Apple", "70:56:81" to "Apple",
        "A0:CE:C8" to "CeLink", "C4:9D:ED" to "Microsoft",
    )

    /** Accepts "F0:9F:C2:..." or "f09fc2..." forms. Returns null when the OUI is unknown. */
    fun lookup(mac: String?): String? {
        if (mac.isNullOrBlank()) return null
        val hex = mac.uppercase().replace("-", ":").let {
            if (it.contains(":")) it else it.chunked(2).joinToString(":")
        }
        val oui = hex.split(":").take(3).joinToString(":")
        if (oui.length < 8) return null
        return table[oui]
    }
}
