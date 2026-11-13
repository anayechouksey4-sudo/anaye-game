package com.nexusx.controller.vm

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.PrivacyRepository
import com.nexusx.core.db.entity.PrivacyMessageEntity
import com.nexusx.core.privacy.InstagramImporter
import com.nexusx.core.privacy.WhatsAppImporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PrivacyUiState(
    val messages: List<PrivacyMessageEntity> = emptyList(),
    val query: String = "",
    val source: String = WhatsAppImporter.SOURCE,
    val lastImport: String? = null,
)

class PrivacyViewModel(private val privacyRepository: PrivacyRepository) : ViewModel() {
    private val query = MutableStateFlow("")
    private val source = MutableStateFlow(WhatsAppImporter.SOURCE)
    private val lastImport = MutableStateFlow<String?>(null)

    @Suppress("OPT_IN_USAGE")
    private val messages = kotlinx.coroutines.flow.combine(query, source) { q, s -> q to s }
        .flatMapLatest { (q, s) ->
            if (q.isBlank()) privacyRepository.observe(s) else privacyRepository.search(q)
        }

    @Suppress("OPT_IN_USAGE")
    val state = kotlinx.coroutines.flow.combine(messages, query, source, lastImport) { msgs, q, s, li ->
        PrivacyUiState(msgs, q, s, li)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PrivacyUiState())

    fun setQuery(q: String) { query.value = q }
    fun setSource(s: String) { source.value = s }

    fun importWhatsApp(uri: Uri, name: String) = viewModelScope.launch {
        val n = privacyRepository.importWhatsApp(uri, name)
        lastImport.value = "Imported $n WhatsApp messages"
        source.value = WhatsAppImporter.SOURCE
    }

    fun importInstagram(uri: Uri) = viewModelScope.launch {
        val n = privacyRepository.importInstagramThread(uri)
        lastImport.value = "Imported $n Instagram messages"
        source.value = InstagramImporter.SOURCE
    }

    fun clear(source: String) = viewModelScope.launch { privacyRepository.clear(source) }
}
