<template>
  <div v-if="imageUrls.length" class="comment-images">
    <el-image
      v-for="(url, index) in imageUrls"
      :key="index"
      class="comment-image-thumb"
      :src="url"
      fit="cover"
      :preview-src-list="imageUrls"
      :initial-index="index"
      preview-teleported
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCommentImageUrl, type CommentImageInfo } from '@/api/tickets'

const props = defineProps<{
  ticketId: number
  images: CommentImageInfo[]
}>()

const imageUrls = ref<string[]>([])

onMounted(async () => {
  const urls = await Promise.all(
    props.images.map((image) => getCommentImageUrl(props.ticketId, image.imageId).catch(() => ''))
  )
  imageUrls.value = urls.filter(Boolean)
})

onBeforeUnmount(() => {
  for (const url of imageUrls.value) {
    URL.revokeObjectURL(url)
  }
})
</script>

<style scoped>
.comment-images {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.comment-image-thumb {
  width: 80px;
  height: 80px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  cursor: pointer;
}
</style>
