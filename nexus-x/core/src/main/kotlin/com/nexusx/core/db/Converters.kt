package com.nexusx.core.db

import androidx.room.TypeConverter

/** Stores small list columns as delimited strings. */
class Converters {
    @TypeConverter
    fun intListToString(list: List<Int>?): String = list?.joinToString(",") ?: ""

    @TypeConverter
    fun stringToIntList(value: String?): List<Int> =
        value?.takeIf { it.isNotBlank() }?.split(",")?.mapNotNull { it.trim().toIntOrNull() } ?: emptyList()

    @TypeConverter
    fun stringListToString(list: List<String>?): String = list?.joinToString("\u001F") ?: ""

    @TypeConverter
    fun stringToStringList(value: String?): List<String> =
        value?.takeIf { it.isNotBlank() }?.split("\u001F") ?: emptyList()
}
