package com.nexusx.core.model

/**
 * How certain NEXUS X is that a device is actually present on the network.
 *
 * Android gives an app that is not the router no authoritative client list, so most
 * discovery results are *inferred* from probes (ARP cache, ping sweep, mDNS). We never
 * present inference as proof. CONFIRMED is reserved for devices we have an authenticated
 * NEXUS X session with, or a direct TCP handshake to a NEXUS X service.
 */
enum class PresenceConfidence {
    /** A NEXUS X Companion we have completed a secure handshake with. */
    CONFIRMED,
    /** Responded to an active probe (ICMP echo / TCP connect) this scan. */
    REACHABLE,
    /** Seen in the ARP cache or an earlier scan but not confirmed reachable now. */
    INFERRED,
    /** Previously observed, not seen in the most recent scan. */
    STALE,
}

/** Result of the most recent reachability probe for a device. */
enum class Reachability { REACHABLE, UNREACHABLE, UNKNOWN }

/** How a device was first surfaced, so the UI can be honest about the source. */
enum class DiscoverySource {
    ARP_CACHE,       // /proc/net/arp or `ip neigh`
    PING_SWEEP,      // ICMP / TCP connect sweep of the subnet
    MDNS_NSD,        // Android Network Service Discovery (_nexusx._tcp etc.)
    NEXUSX_SERVICE,  // Direct connection to a NEXUS X Companion
    MANUAL,          // Entered by the user
}
