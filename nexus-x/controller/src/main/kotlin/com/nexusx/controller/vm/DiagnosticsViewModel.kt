package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.core.crypto.AndroidKeyVault
import com.nexusx.core.crypto.CryptoBox
import com.nexusx.core.crypto.KeyExchange
import com.nexusx.core.crypto.SecureChannel
import com.nexusx.core.net.wire.WireMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class CheckStatus { PASS, FAIL, INFO }
data class DiagnosticCheck(val name: String, val detail: String, val status: CheckStatus)
data class DiagnosticsUiState(val checks: List<DiagnosticCheck> = emptyList(), val running: Boolean = false)

/** Runs real self-tests on device: crypto round-trip, keystore, and network readiness. */
class DiagnosticsViewModel(
    private val deviceRepository: DeviceRepository,
    private val keyVault: AndroidKeyVault,
) : ViewModel() {
    private val _state = MutableStateFlow(DiagnosticsUiState())
    val state = _state.asStateFlow()

    fun run() = viewModelScope.launch {
        _state.value = DiagnosticsUiState(running = true)
        val checks = withContext(Dispatchers.Default) { buildList {
            add(cryptoRoundTrip())
            add(secureChannelCheck())
            add(keystoreCheck())
            addAll(networkChecks())
        } }
        _state.value = DiagnosticsUiState(checks = checks, running = false)
    }

    private fun cryptoRoundTrip(): DiagnosticCheck = runCatching {
        val a = KeyExchange.generateEphemeralKeyPair(); val b = KeyExchange.generateEphemeralKeyPair()
        val s1 = KeyExchange.sharedSecret(a.private, b.public)
        val s2 = KeyExchange.sharedSecret(b.private, a.public)
        require(s1.contentEquals(s2)) { "ECDH mismatch" }
        val key = CryptoBox.randomKey()
        val sealed = CryptoBox.seal(key, "diagnostic".toByteArray())
        require(String(CryptoBox.open(key, sealed)) == "diagnostic")
        DiagnosticCheck("End-to-end cryptography", "ECDH P-256 + AES-256-GCM round-trip OK", CheckStatus.PASS)
    }.getOrElse { DiagnosticCheck("End-to-end cryptography", it.message ?: "failed", CheckStatus.FAIL) }

    private fun secureChannelCheck(): DiagnosticCheck = runCatching {
        val k1 = CryptoBox.randomKey(); val k2 = CryptoBox.randomKey(); val sid = ByteArray(16)
        val a = SecureChannel(k1, k2, sid); val b = SecureChannel(k2, k1, sid)
        val frame = a.encrypt(WireMessage.encode(WireMessage.Ping(7)))
        val got = WireMessage.decode(b.decrypt(frame)) as WireMessage.Ping
        require(got.nonce == 7L)
        DiagnosticCheck("Secure channel framing", "Encrypted Ping/Pong exchange verified", CheckStatus.PASS)
    }.getOrElse { DiagnosticCheck("Secure channel framing", it.message ?: "failed", CheckStatus.FAIL) }

    private fun keystoreCheck(): DiagnosticCheck = runCatching {
        keyVault.identityPublicKey()
        DiagnosticCheck("Hardware keystore", "Identity key present in AndroidKeyStore", CheckStatus.PASS)
    }.getOrElse { DiagnosticCheck("Hardware keystore", it.message ?: "unavailable", CheckStatus.FAIL) }

    private fun networkChecks(): List<DiagnosticCheck> {
        val n = deviceRepository.networkInfo.value
        return listOf(
            DiagnosticCheck("Transport", n.transport.name, CheckStatus.INFO),
            DiagnosticCheck(
                "Local address",
                n.localIp ?: "unavailable",
                if (n.localIp != null) CheckStatus.PASS else CheckStatus.FAIL,
            ),
            DiagnosticCheck("Gateway", n.gatewayIp ?: "unknown", if (n.gatewayIp != null) CheckStatus.PASS else CheckStatus.INFO),
            DiagnosticCheck("VPN active", if (n.isVpnActive) "yes (discovery scoped to VPN)" else "no", CheckStatus.INFO),
            DiagnosticCheck("Client list from OS", if (n.clientListAvailable) "available" else "not available (expected off-router)", CheckStatus.INFO),
        )
    }
}
