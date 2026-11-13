package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.transfer.ChunkPlan
import org.junit.Test

class ChunkPlanTest {
    @Test fun counts_and_last_partial_chunk() {
        assertThat(ChunkPlan.chunkCount(0, 100)).isEqualTo(0)
        assertThat(ChunkPlan.chunkCount(100, 100)).isEqualTo(1)
        assertThat(ChunkPlan.chunkCount(101, 100)).isEqualTo(2)
        assertThat(ChunkPlan.sizeOfChunk(1, 150, 100)).isEqualTo(50)
        assertThat(ChunkPlan.sizeOfChunk(2, 150, 100)).isEqualTo(0)
    }

    @Test fun offset_resume_mapping() {
        assertThat(ChunkPlan.chunkIndexForOffset(250, 100)).isEqualTo(2)
        assertThat(ChunkPlan.offsetForChunk(3, 100)).isEqualTo(300)
        assertThat(ChunkPlan.progress(50, 200)).isWithin(0.001f).of(0.25f)
    }
}
